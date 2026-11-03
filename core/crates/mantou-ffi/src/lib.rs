//! Mantou native core: the C ABI loaded by Bun through `bun:ffi`.
//!
//! Every UI lives in an **instance** (`instance.rs`): a shadow tree, its latest
//! scene, its event queue and counters, addressed by a u32 handle. The window
//! is one instance (`mt_app`); tests create headless ones (`mt_headless_new`)
//! that run without a window, on the caller's thread (design §12.2).
//!
//! Threads for the window (design §4–§5):
//!
//! - `mt_run` is called by Bun's **main thread** and runs the winit event loop
//!   there until the app quits (`window.rs`). No JavaScript runs on this thread
//!   after that.
//! - The app runs in a Bun `Worker`. `mt_commit` runs on the Worker's thread:
//!   it applies the batch, lays out and publishes a new scene, then asks the
//!   main thread for a frame.
//! - The main thread draws the latest scene, lays out again on resize, and
//!   hit-tests input. Events reach the Worker with one coalesced wake-up per
//!   batch (a threadsafe `JSCallback`) and `mt_take_events`.
//!
//! Every exported function takes scalars, pointers and lengths only (`bun:ffi`
//! cannot pass structs by value), and none lets a panic cross the ABI.

mod instance;
mod window;

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use instance::{Instance, STAT_COUNT, bump, lock};
use mantou_render::Offscreen;
use mantou_tree::protocol::event as ev;
use winit::event_loop::{ControlFlow, EventLoop, EventLoopProxy};

/// Bumped on any change to an exported signature or the op/event formats.
/// 2: the shadow-tree protocol. 3: instance handles on every per-UI function; headless instances.
/// 4: text, wheel events, key modifiers; mt_test_key, mt_test_wheel; a glyphs counter.
pub const ABI_VERSION: u32 = 4;

/// The window's instance.
const APP: u32 = 1;

#[derive(Debug)]
pub(crate) enum UserEvent {
    Redraw,
    Quit,
    Resize(u32, u32),
    /// Test input, handled exactly as the window's own: kind 0 = down, 1 = up, 2 = move.
    TestPointer(u32, f32, f32),
    TestKey(u32, bool, u32),
    TestWheel(f32, f32, f32, f32),
}

/// Process-wide state: the instances and the window's event loop.
pub(crate) struct Globals {
    instances: Mutex<HashMap<u32, Arc<Instance>>>,
    next_handle: AtomicU32,
    proxy: Mutex<Option<EventLoopProxy<UserEvent>>>,
    quit_requested: AtomicBool,
    pub(crate) exit_code: AtomicI32,
    pub(crate) info: Mutex<String>,
    /// One GPU device for every headless instance's captures, opened on first use.
    offscreen: Mutex<Option<Result<Offscreen, String>>>,
}

pub(crate) static G: LazyLock<Globals> = LazyLock::new(|| Globals {
    instances: Mutex::new(HashMap::new()),
    next_handle: AtomicU32::new(APP + 1),
    proxy: Mutex::new(None),
    quit_requested: AtomicBool::new(false),
    exit_code: AtomicI32::new(0),
    info: Mutex::new(String::new()),
    offscreen: Mutex::new(None),
});

/// The window's instance (created on first use).
pub(crate) fn app() -> Arc<Instance> {
    lock(&G.instances).entry(APP).or_insert_with(|| Arc::new(Instance::new(false))).clone()
}

fn get(handle: u32) -> Option<Arc<Instance>> {
    if handle == APP {
        return Some(app());
    }
    lock(&G.instances).get(&handle).cloned()
}

fn send(ev: UserEvent) -> bool {
    lock(&G.proxy).as_ref().is_some_and(|p| p.send_event(ev).is_ok())
}

fn guard<R>(fallback: R, f: impl FnOnce() -> R) -> R {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            let msg = p
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| p.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".into());
            eprintln!("mantou-core: panic: {msg}");
            fallback
        }
    }
}

/// Runs `f` with the instance, or returns `fallback` for an unknown handle.
fn with<R: Copy>(handle: u32, fallback: R, f: impl FnOnce(&Arc<Instance>) -> R) -> R {
    guard(fallback, || match get(handle) {
        Some(inst) => f(&inst),
        None => {
            eprintln!("mantou-core: no instance {handle}");
            fallback
        }
    })
}

/// # Safety
/// `ptr` must be valid for `len` bytes, or null with `len` 0.
unsafe fn bytes<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        // SAFETY: guaranteed by the caller.
        unsafe { std::slice::from_raw_parts(ptr, len as usize) }
    }
}

/// # Safety
/// `ptr` must be valid for writes of `len` bytes, or null with `len` 0.
unsafe fn bytes_mut<'a>(ptr: *mut u8, len: u32) -> &'a mut [u8] {
    if ptr.is_null() || len == 0 {
        &mut []
    } else {
        // SAFETY: guaranteed by the caller.
        unsafe { std::slice::from_raw_parts_mut(ptr, len as usize) }
    }
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn mt_abi_version() -> u32 {
    ABI_VERSION
}

/// The window's instance handle.
#[unsafe(no_mangle)]
pub extern "C" fn mt_app() -> u32 {
    APP
}

/// Writes a UTF-8 description of the GPU adapter (the window's, else the
/// offscreen one's) and the OS into `dst`; returns its length.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_info(dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    guard(0, || {
        let mut info = lock(&G.info).clone();
        if info.is_empty()
            && let Some(Ok(o)) = lock(&G.offscreen).as_ref()
        {
            info = format!("{} (offscreen); {}", o.info(), std::env::consts::OS);
        }
        let n = info.len().min(out.len());
        out[..n].copy_from_slice(&info.as_bytes()[..n]);
        n as u32
    })
}

/// Runs the window's event loop on the calling thread, which must be the
/// process's main thread, until `mt_quit`. Config: `[width, height, titleLen]`
/// as u32 words, then the title's UTF-8 bytes.
///
/// # Safety
/// `cfg` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_run(cfg: *const u8, len: u32) -> i32 {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(cfg, len) };
    guard(101, || {
        let config = window::Config::parse(b);
        let event_loop = match EventLoop::<UserEvent>::with_user_event().build() {
            Ok(el) => el,
            Err(e) => {
                eprintln!("mantou-core: cannot start the event loop: {e}");
                return 102;
            }
        };
        event_loop.set_control_flow(ControlFlow::Wait);
        *lock(&G.proxy) = Some(event_loop.create_proxy());
        if G.quit_requested.load(Ordering::Acquire) {
            *lock(&G.proxy) = None;
            return G.exit_code.load(Ordering::Acquire);
        }
        let mut app = window::App::new(config);
        let result = event_loop.run_app(&mut app);
        *lock(&G.proxy) = None;
        drop(app);
        if let Err(e) = result {
            eprintln!("mantou-core: event loop failed: {e}");
            return 103;
        }
        G.exit_code.load(Ordering::Acquire)
    })
}

/// Asks the window's event loop to end; `mt_run` then returns `code`.
#[unsafe(no_mangle)]
pub extern "C" fn mt_quit(code: i32) {
    guard((), || {
        G.exit_code.store(code, Ordering::Release);
        G.quit_requested.store(true, Ordering::Release);
        send(UserEvent::Quit);
    })
}

// ---------------------------------------------------------------------------
// Per instance
// ---------------------------------------------------------------------------

/// Registers the Worker's wake-up callback (a threadsafe JSCallback). Headless
/// instances need none: their caller takes events after each call.
#[unsafe(no_mangle)]
pub extern "C" fn mt_set_wake(inst: u32, f: Option<extern "C" fn()>) {
    with(inst, (), |i| i.set_wake(f))
}

/// Applies a batch of ops (one per JS turn), lays out and publishes the scene;
/// for the window, also asks the main thread for a frame. Returns 0, or -1 for
/// a malformed batch, which is rejected whole. Ops that make no sense (unknown
/// ids…) are skipped and counted (`op_errors`).
///
/// # Safety
/// `ptr` must be valid for `len` bytes for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_commit(inst: u32, ptr: *const u8, len: u32) -> i32 {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(ptr, len) };
    with(inst, -2, |i| {
        let r = i.commit(b);
        if r == 0 && !i.headless && send(UserEvent::Redraw) {
            bump(&i.stats.redraw_requests);
        }
        r
    })
}

/// Copies whole queued event records into `dst` (at most `cap` bytes) and
/// returns the number of bytes written. Call again while it returns a full buffer.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_take_events(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| i.take_events(out) as u32)
}

/// Writes up to `cap` counters into `dst` and returns how many it wrote:
/// frames, commits, wakes, events, resizes, redraw requests, layouts, ops,
/// op errors, rectangles (last scene), nodes, presses, glyphs (last scene).
///
/// # Safety
/// `dst` must be valid for writes of `cap` u64 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_stats(inst: u32, dst: *mut u64, cap: u32) -> u32 {
    with(inst, 0, |i| {
        if dst.is_null() {
            return 0;
        }
        let all = i.stats_array();
        let n = STAT_COUNT.min(cap as usize);
        // SAFETY: dst is valid for cap >= n u64 writes.
        unsafe { std::ptr::copy_nonoverlapping(all.as_ptr(), dst, n) };
        n as u32
    })
}

// ---------------------------------------------------------------------------
// Headless instances and test hooks (design §12.2)
// ---------------------------------------------------------------------------

/// Creates a headless instance with a viewport of `width_px` × `height_px` at
/// `scale`. Returns its handle.
#[unsafe(no_mangle)]
pub extern "C" fn mt_headless_new(width_px: u32, height_px: u32, scale: f32) -> u32 {
    guard(0, || {
        let handle = G.next_handle.fetch_add(1, Ordering::Relaxed);
        let inst = Arc::new(Instance::new(true));
        inst.relayout(width_px.max(1), height_px.max(1), scale);
        lock(&G.instances).insert(handle, inst);
        handle
    })
}

/// Frees a headless instance. The window's instance cannot be freed.
#[unsafe(no_mangle)]
pub extern "C" fn mt_headless_free(inst: u32) {
    guard((), || {
        if inst != APP {
            lock(&G.instances).remove(&inst);
        }
    })
}

/// Test input at (x, y) in logical px: kind 0 = primary down, 1 = up, 2 = move.
/// Headless: handled at once on this thread. Window: handled on the main
/// thread exactly as the window's own input.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_input(inst: u32, kind: u32, x: f32, y: f32) {
    with(inst, (), |i| {
        if i.headless {
            i.pointer(kind, x, y);
        } else {
            send(UserEvent::TestPointer(kind, x, y));
        }
    })
}

/// Test hook: a key event. `key` is a Unicode scalar or a named key code
/// (protocol `named_key`), `modifiers` the `key_modifier` bits.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_key(inst: u32, key: u32, down: u32, modifiers: u32) {
    with(inst, (), |i| {
        if i.headless {
            i.key(key, down != 0, false, modifiers);
        } else {
            send(UserEvent::TestKey(key, down != 0, modifiers));
        }
    })
}

/// Test hook: a wheel scroll at (x, y) logical px by (dx, dy); positive dy scrolls content up.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_wheel(inst: u32, x: f32, y: f32, dx: f32, dy: f32) {
    with(inst, (), |i| {
        if i.headless {
            i.wheel(x, y, dx, dy);
        } else {
            send(UserEvent::TestWheel(x, y, dx, dy));
        }
    })
}

/// Test hook: resizes the instance. Headless: lays out at once and queues a
/// RESIZED event. Window: asks the window for the new size (scale is the display's).
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_viewport(inst: u32, width_px: u32, height_px: u32, scale: f32) {
    with(inst, (), |i| {
        if i.headless {
            i.relayout(width_px.max(1), height_px.max(1), scale);
            bump(&i.stats.resizes);
            i.push_event([ev::RESIZED, width_px, height_px, 0]);
        } else {
            send(UserEvent::Resize(width_px, height_px));
        }
    })
}

/// Advances a headless instance's manual clock by `advance_ms` and does what
/// is due (for now: lays out if anything changed). Returns flags: bit 0 = events are
/// waiting for `mt_take_events`, bit 1 = a layout ran.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_step(inst: u32, advance_ms: f64) -> u32 {
    with(inst, 0, |i| {
        let mut ran = false;
        if i.headless {
            *lock(&i.clock_ms) += advance_ms.max(0.0);
            ran = i.layout_if_needed();
        }
        (i.events_pending() as u32) | ((ran as u32) << 1)
    })
}

/// Test hook: the topmost node at (x, y) logical px, or 0.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_hit(inst: u32, x: f32, y: f32) -> u32 {
    with(inst, 0, |i| lock(&i.tree).hit(x, y).unwrap_or(0))
}

/// Test hook: writes the node's box (x0, y0, x1, y1, logical px, last layout)
/// into `dst[0..4]`. Returns 0, or -1 when the node isn't laid out.
///
/// # Safety
/// `dst` must be valid for writes of 4 f32 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_node_rect(inst: u32, id: u32, dst: *mut f32) -> i32 {
    with(inst, -1, |i| {
        let Some(r) = lock(&i.tree).rect(id) else { return -1 };
        if dst.is_null() {
            return -1;
        }
        // SAFETY: dst is valid for 4 f32 writes.
        unsafe { std::ptr::copy_nonoverlapping(r.as_ptr(), dst, 4) };
        0
    })
}

/// Test hook: the latest scene as text (`Scene::dump`). Writes at most `cap`
/// bytes and returns the full length; call again with a larger buffer if needed.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_scene(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| {
        let text = lock(&i.scene).dump();
        let n = text.len().min(out.len());
        out[..n].copy_from_slice(&text.as_bytes()[..n]);
        text.len() as u32
    })
}

/// Test hook: renders a headless instance's latest scene offscreen and writes
/// its pixels (RGBA8, sRGB, top row first) into `dst`. Returns the bytes
/// written, -1 when no GPU adapter is available, -2 when `cap` is smaller than
/// width × height × 4, -3 for the window's instance.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_capture(inst: u32, dst: *mut u8, cap: u32) -> i32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, -1, |i| {
        if !i.headless {
            return -3;
        }
        let scene = lock(&i.scene).clone();
        let need = scene.size_px.0.max(1) as usize * scene.size_px.1.max(1) as usize * 4;
        if out.len() < need {
            return -2;
        }
        let mut slot = lock(&G.offscreen);
        let offscreen = slot.get_or_insert_with(|| {
            Offscreen::new().inspect_err(|e| eprintln!("mantou-core: offscreen rendering unavailable: {e}"))
        });
        let Ok(offscreen) = offscreen.as_mut() else { return -1 };
        let pixels = offscreen.capture(&scene);
        out[..pixels.len()].copy_from_slice(&pixels);
        bump(&i.stats.frames);
        pixels.len() as i32
    })
}

/// Test hook: from a native thread, asks the window to resize `count` times,
/// `interval_ms` apart, alternating between two sizes. It runs even while the
/// Worker is busy.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_resize(count: u32, interval_ms: u32, w0: u32, h0: u32, w1: u32, h1: u32) {
    guard((), || {
        std::thread::spawn(move || {
            for n in 0..count {
                std::thread::sleep(Duration::from_millis(interval_ms as u64));
                let (w, h) = if n % 2 == 0 { (w0, h0) } else { (w1, h1) };
                send(UserEvent::Resize(w, h));
            }
        });
    })
}
