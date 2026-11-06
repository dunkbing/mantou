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

/// Writes "mantou-core: …" to stderr, ignoring failure. Never `eprintln!`:
/// it panics when the write fails, and Bun makes stderr non-blocking, so a
/// full pipe (EAGAIN) would take the whole event loop down.
macro_rules! log {
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let _ = writeln!(std::io::stderr().lock(), "mantou-core: {}", format_args!($($arg)*));
    }};
}

mod crash;
mod instance;
mod dialogs;
mod platform;
mod webview;
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
/// 5: text input: variable-length event records, mt_test_text, mt_test_ime, mt_test_clipboard,
/// mt_test_set_clipboard, mt_test_value, mt_test_focused.
/// 6: platform services: mt_service, SERVICE_RESULT and MENU events; mt_test_answer, mt_test_service, mt_test_menu.
/// 7: the window config (mt_run) carries size limits and flags.
/// 8: mt_input_selection; hover (POINTER_ENTER, POINTER_LEAVE), mt_test_input kind 3 (the pointer leaves), mt_test_cursor.
/// 12: the window config has x and y words and more flags; the WINDOW_STATE event; the "window" service.
/// 11: FILE_DROP and the Drop listener bit; mt_test_drop.
/// 10: pointer events on nodes: the NODE_POINTER event and Pointer listener bit; mt_test_button.
/// 9: the accessibility tree: mt_test_access (and the ACCESS op).
/// 13: mt_reset (mantou dev's reloads).
/// 14: more windows: mt_window_open, mt_window_close, mt_window_focus.
/// 15: crash reports: mt_set_crash_dir, the CORE_ERROR event, mt_test_panic.
/// 16: Html nodes: mt_html_link_at and the HTML_REQUEST event.
/// 17: mt_render_image (icons for `mantou package`).
pub const ABI_VERSION: u32 = 17;

/// An Input's selection (anchor, focus = the caret), in UTF-16 code units of
/// its text, into `dst[0..2]`. Returns 0, or -1 when `id` isn't an input.
///
/// # Safety
/// `dst` must be valid for writes of 2 u32 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_input_selection(inst: u32, id: u32, dst: *mut u32) -> i32 {
    with(inst, -1, |i| {
        let Some((a, f)) = lock(&i.tree).selection_utf16(id) else { return -1 };
        if dst.is_null() {
            return -1;
        }
        // SAFETY: dst is valid for 2 u32 writes.
        unsafe { std::ptr::copy_nonoverlapping([a as u32, f as u32].as_ptr(), dst, 2) };
        0
    })
}

/// The first window's instance (the one `mt_run` opens).
pub(crate) const APP: u32 = 1;

/// Work for the main thread. The first `u32` of most is the instance (window) it's for.
#[derive(Debug)]
pub(crate) enum UserEvent {
    Redraw(u32),
    Quit,
    Resize(u32, u32, u32),
    /// Another window, for an instance `mt_window_open` made; closing it; bringing it to the front.
    OpenWindow(u32, window::Config),
    CloseWindow(u32),
    FocusWindow(u32),
    /// Test input, handled exactly as the window's own: kind 0 = down, 1 = up, 2 = move.
    TestPointer(u32, u32, f32, f32),
    TestKey(u32, u32, bool, u32),
    TestWheel(u32, f32, f32, f32, f32),
    TestText(u32, String),
    TestIme(u32, String, Option<(usize, usize)>),
    /// A platform service request (JSON) to run on the main thread: the instance, the request's id and body.
    Service(u32, u32, String),
    /// Assistive technology asking for the tree or an action (accesskit_winit's events).
    Access(accesskit_winit::Event),
}

impl From<accesskit_winit::Event> for UserEvent {
    fn from(e: accesskit_winit::Event) -> Self {
        UserEvent::Access(e)
    }
}

/// Process-wide state: the instances and the window's event loop.
pub(crate) struct Globals {
    instances: Mutex<HashMap<u32, Arc<Instance>>>,
    next_handle: AtomicU32,
    proxy: Mutex<Option<EventLoopProxy<UserEvent>>>,
    /// Service requests made before the event loop started (the app's first turn runs before `mt_run` is up); sent when it is.
    early: Mutex<Vec<UserEvent>>,
    /// Whether `mt_run` has started its loop (once; a request after it ended is refused, not queued).
    started: AtomicBool,
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
    early: Mutex::new(Vec::new()),
    started: AtomicBool::new(false),
    quit_requested: AtomicBool::new(false),
    exit_code: AtomicI32::new(0),
    info: Mutex::new(String::new()),
    offscreen: Mutex::new(None),
});

/// The window's instance (created on first use).
pub(crate) fn app() -> Arc<Instance> {
    lock(&G.instances).entry(APP).or_insert_with(|| Arc::new(Instance::new(false))).clone()
}

/// An instance by handle (for the window module).
pub(crate) fn instance(handle: u32) -> Option<Arc<Instance>> {
    get(handle)
}

/// Drops a closed window's instance.
pub(crate) fn forget(handle: u32) {
    if handle != APP {
        lock(&G.instances).remove(&handle);
    }
}

fn get(handle: u32) -> Option<Arc<Instance>> {
    if handle == APP {
        return Some(app());
    }
    lock(&G.instances).get(&handle).cloned()
}

/// Sends a service request; before the event loop has started, holds it until it does.
fn send_service(ev: UserEvent) -> bool {
    let proxy = lock(&G.proxy);
    match proxy.as_ref() {
        Some(p) => p.send_event(ev).is_ok(),
        None if !G.started.load(Ordering::Acquire) => {
            lock(&G.early).push(ev);
            true
        }
        None => false,
    }
}

fn send(ev: UserEvent) -> bool {
    lock(&G.proxy).as_ref().is_some_and(|p| p.send_event(ev).is_ok())
}

/// Runs `f`, catching a panic: it's logged (and reported, see crash.rs), the first window's app hears
/// CORE_ERROR, and `fallback` is returned.
fn guard<R>(fallback: R, f: impl FnOnce() -> R) -> R {
    guard_for(None, fallback, f)
}

/// `guard`, telling `inst`'s app about a panic (else the first window's).
fn guard_for<R>(inst: Option<&Instance>, fallback: R, f: impl FnOnce() -> R) -> R {
    crash::install();
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            // The hook logged it and wrote the report; it has unwound now, so no lock is held.
            let (message, report) = crash::take().unwrap_or_else(|| {
                let m = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown panic".into());
                (m, String::new())
            });
            let json = serde_json::json!({ "message": message, "report": report }).to_string();
            match inst {
                Some(i) => i.push_core_error(&json),
                None => app().push_core_error(&json),
            }
            fallback
        }
    }
}

/// Runs `f` with the instance, or returns `fallback` for an unknown handle.
fn with<R: Copy>(handle: u32, fallback: R, f: impl FnOnce(&Arc<Instance>) -> R) -> R {
    let Some(inst) = get(handle) else {
        log!("no instance {handle}");
        return fallback;
    };
    guard_for(Some(&inst), fallback, || f(&inst))
}

/// Where the core writes crash reports (the app's data folder's `crashes`; created with the first
/// report). A panic on any thread writes one; see `CORE_ERROR` for those the core recovers from.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_set_crash_dir(ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let dir = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    guard((), || crash::set_dir((!dir.is_empty()).then(|| dir.into())))
}

/// Test hook: panics inside a call for the instance (the core recovers; a report and CORE_ERROR follow).
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_panic(inst: u32) {
    with(inst, (), |_| panic!("test panic"))
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
/// process's main thread, until `mt_quit`. Config: `[width, height, titleLen,
/// minWidth, minHeight, maxWidth, maxHeight, flags, x, y]` as u32 words (logical px,
/// 0 = no limit), then the title's UTF-8 bytes.
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
                log!("cannot start the event loop: {e}");
                return 102;
            }
        };
        event_loop.set_control_flow(ControlFlow::Wait);
        {
            let proxy = event_loop.create_proxy();
            let mut slot = lock(&G.proxy);
            G.started.store(true, Ordering::Release);
            for ev in lock(&G.early).drain(..) {
                let _ = proxy.send_event(ev);
            }
            *slot = Some(proxy);
        }
        if G.quit_requested.load(Ordering::Acquire) {
            *lock(&G.proxy) = None;
            return G.exit_code.load(Ordering::Acquire);
        }
        let mut app = window::App::new(config);
        let result = event_loop.run_app(&mut app);
        *lock(&G.proxy) = None;
        drop(app);
        if let Err(e) = result {
            log!("event loop failed: {e}");
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

/// Starts an instance's UI over for a new app Worker, keeping its window (`mantou dev`'s
/// reloads): the wake-up callback goes, the tree is emptied at the same size, queued events
/// are dropped, and a WINDOW_READY waits for the next callback. Call it before terminating
/// the old Worker: no wake-up reaches that Worker once this returns. Resetting the first
/// window also closes the app's other windows.
#[unsafe(no_mangle)]
pub extern "C" fn mt_reset(inst: u32) {
    with(inst, (), |i| {
        i.reset();
        if !i.headless {
            send(UserEvent::Redraw(inst));
        }
    });
    // The other windows belong to the same app Worker: they go with it.
    if inst == APP {
        let others: Vec<(u32, Arc<Instance>)> = lock(&G.instances).iter().filter(|(h, i)| **h != APP && !i.headless).map(|(h, i)| (*h, i.clone())).collect();
        for (h, i) in others {
            i.set_wake(None);
            send(UserEvent::CloseWindow(h));
        }
    }
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
        if r == 0 && !i.headless && send(UserEvent::Redraw(inst)) {
            bump(&i.stats.redraw_requests);
        }
        r
    })
}

/// Copies whole queued event records into `dst` (at most `cap` bytes) and
/// returns the number of bytes written; call again until it returns 0. When
/// the next record alone is larger than `cap`, writes nothing and returns
/// `0x80000000 | its size`: call again with a buffer that large.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_take_events(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| i.take_events(out))
}

/// Writes up to `cap` counters into `dst` and returns how many it wrote:
/// frames, commits, wakes, events, resizes, redraw requests, layouts, ops,
/// op errors, rectangles (last scene), nodes, presses, glyphs (last scene),
/// scenes built, text layouts computed.
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

/// Opens another window, as the config says (`mt_run`'s format), with an
/// instance of its own; returns its handle (0 before the first window's loop
/// runs). WINDOW_READY comes to that instance once it's open (CLOSE_REQUESTED
/// if it couldn't be). Commit to it, take its events and register its wake-up
/// as for the first window (dunkbing/mantou#23).
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_window_open(ptr: *const u8, len: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let config = window::Config::parse(unsafe { bytes(ptr, len) });
    guard(0, || {
        if lock(&G.proxy).is_none() {
            return 0;
        }
        let handle = G.next_handle.fetch_add(1, Ordering::Relaxed);
        lock(&G.instances).insert(handle, Arc::new(Instance::new(false)));
        if send(UserEvent::OpenWindow(handle, config)) {
            handle
        } else {
            forget(handle);
            0
        }
    })
}

/// Closes a window `mt_window_open` opened, and frees its instance. (The first window closes with the app.)
#[unsafe(no_mangle)]
pub extern "C" fn mt_window_close(inst: u32) {
    guard((), || {
        if inst != APP {
            // No wake-up reaches its Worker callback after this returns.
            if let Some(i) = get(inst) {
                i.set_wake(None);
            }
            send(UserEvent::CloseWindow(inst));
        }
    })
}

/// Brings a window to the front and gives it the keyboard.
#[unsafe(no_mangle)]
pub extern "C" fn mt_window_focus(inst: u32) {
    guard((), || {
        send(UserEvent::FocusWindow(inst));
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

/// Test input at (x, y) in logical px: kind 0 = primary down, 1 = up, 2 = move, 3 = the pointer left the window.
/// Headless: handled at once on this thread. Window: handled on the main
/// thread exactly as the window's own input.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_input(inst: u32, kind: u32, x: f32, y: f32) {
    with(inst, (), |i| {
        if i.headless {
            i.pointer(kind, x, y);
        } else {
            send(UserEvent::TestPointer(inst, kind, x, y));
        }
    })
}

/// Test hook: a button other than the primary one at (x, y), headless instances only. kind: 0 = down, 1 = up;
/// button: the protocol's button code (1 middle, 2 secondary).
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_button(inst: u32, kind: u32, button: u32, x: f32, y: f32) {
    with(inst, (), |i| {
        if i.headless {
            i.pointer_button(kind, button, x, y);
        }
    })
}

/// Test hook: a key event. `key` is a Unicode scalar or a named key code
/// (protocol `named_key`), `modifiers` the `key_modifier` bits. A printable
/// character types itself, as on a keyboard.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_key(inst: u32, key: u32, down: u32, modifiers: u32) {
    with(inst, (), |i| {
        if i.headless {
            i.key(key, key_text(key).as_deref(), down != 0, false, modifiers);
        } else {
            send(UserEvent::TestKey(inst, key, down != 0, modifiers));
        }
    })
}

/// What a key code types when pressed: itself, if it's a printable character.
pub(crate) fn key_text(key: u32) -> Option<String> {
    char::from_u32(key).filter(|c| !c.is_control()).map(String::from)
}

/// Test hook: text arriving for the focused input at once, as an IME commit
/// or a paste would (undo treats it as one step).
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_text(inst: u32, ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(ptr, len) };
    let text = String::from_utf8_lossy(b).into_owned();
    with(inst, (), |i| {
        if i.headless {
            i.insert_text(&text);
        } else {
            send(UserEvent::TestText(inst, text));
        }
    })
}

/// Test hook: an IME composition in progress (empty ends it), with the
/// composition's cursor as a byte range, or `u32::MAX` twice for none.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_ime(inst: u32, ptr: *const u8, len: u32, cursor_start: u32, cursor_end: u32) {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(ptr, len) };
    let text = String::from_utf8_lossy(b).into_owned();
    let cursor = (cursor_start != u32::MAX).then(|| (cursor_start as usize, (cursor_end as usize).max(cursor_start as usize)));
    let cursor = cursor.filter(|c| c.1 <= text.len() && text.is_char_boundary(c.0) && text.is_char_boundary(c.1));
    with(inst, (), |i| {
        if i.headless {
            i.ime_preedit(&text, cursor);
        } else {
            send(UserEvent::TestIme(inst, text, cursor));
        }
    })
}

/// Test hook: puts text on the instance's clipboard (the system's, for the window).
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_set_clipboard(inst: u32, ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(ptr, len) };
    let text = String::from_utf8_lossy(b).into_owned();
    with(inst, (), |i| i.with_clipboard(|cb| cb.set(&text)))
}

/// Test hook: the clipboard's text. Writes at most `cap` bytes and returns the full length.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_clipboard(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| write_str(out, &i.with_clipboard(|cb| cb.get()).unwrap_or_default()))
}

/// Asks for a platform service (dialogs, context menus, the app menu) with a JSON
/// request. The answer comes back as a `SERVICE_RESULT` event with the same `req`.
/// A headless instance answers at once from the queue `mt_test_answer` fills (a
/// cancel when it's empty) and remembers the request for `mt_test_service`.
/// Returns 0, or 1 when the request couldn't be queued.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_service(inst: u32, req: u32, ptr: *const u8, len: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let body = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    with(inst, 1, |i| {
        if i.clipboard_service(req, &body) {
            0
        } else if i.headless {
            *lock(&i.last_service) = body;
            match i.next_answer() {
                Some(Some(a)) => i.push_service_result(req, Some(&a)),
                _ => i.push_service_result(req, None),
            }
            0
        } else if send_service(UserEvent::Service(inst, req, body)) {
            0
        } else {
            1
        }
    })
}

/// Test hook: files held over the window (`kind` 0), left it (1) or dropped (2); `ptr` is a JSON array of paths.
/// Headless instances only.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_drop(inst: u32, kind: u32, ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let body = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    with(inst, (), |i| {
        if i.headless {
            i.file_drop(kind, &serde_json::from_str::<Vec<String>>(&body).unwrap_or_default());
        }
    })
}

/// Test hook: queues the answer (JSON) for the next service request of a headless
/// instance; an empty one cancels it.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_answer(inst: u32, ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let a = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    with(inst, (), |i| i.queue_answer(if a.is_empty() { None } else { Some(a) }));
}

/// Test hook: the last service request (JSON). Writes at most `cap` bytes and returns the full length.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_service(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| write_str(out, &lock(&i.last_service)))
}

/// Test hook: the accessibility tree as indented text (`Tree::accessibility_dump`).
/// Writes at most `cap` bytes and returns the full length.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_access(inst: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| write_str(out, &lock(&i.tree).accessibility_dump()))
}

/// Test hook: the user chooses the app-menu item `id`.
///
/// # Safety
/// `ptr` must be valid for `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_menu(inst: u32, ptr: *const u8, len: u32) {
    // SAFETY: guaranteed by the caller.
    let id = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    with(inst, (), |i| i.push_menu(&id));
}

/// Test hook: an input's text as the core has it. Writes at most `cap` bytes
/// and returns the full length, or `u32::MAX` when `id` isn't an input.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_value(inst: u32, id: u32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, u32::MAX, |i| match lock(&i.tree).value_of(id) {
        Some(v) => write_str(out, &v),
        None => u32::MAX,
    })
}

/// Renders image bytes (PNG, JPEG, WebP or SVG) at exactly `width` × `height` px into `dst` as RGBA with straight
/// alpha (`width * height * 4` bytes): an SVG is rasterized at that size, a raster image scaled. For icons.
/// Returns 0; -1 when the bytes aren't an image; -2 when `dst` is too small.
///
/// # Safety
/// `ptr` must be valid for `len` bytes and `dst` for `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_render_image(ptr: *const u8, len: u32, width: u32, height: u32, dst: *mut u8, cap: u32) -> i32 {
    // SAFETY: guaranteed by the caller.
    let (src, out) = unsafe { (bytes(ptr, len), bytes_mut(dst, cap)) };
    guard(-1, || {
        let Some(px) = mantou_image::Image::decode(src).ok().and_then(|i| i.render(width, height)) else { return -1 };
        if out.len() < px.rgba.len() {
            return -2;
        }
        out[..px.rgba.len()].copy_from_slice(&px.rgba);
        0
    })
}

/// The `href` of the link at (x, y) (logical px, the window's) in Html node `id`, copied into `dst` as
/// UTF-8 as far as it fits; returns its full length, or 0 when there is no link there.
///
/// # Safety
/// `dst` must be valid for `cap` bytes, or null with `cap` 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_html_link_at(inst: u32, id: u32, x: f32, y: f32, dst: *mut u8, cap: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    let out = unsafe { bytes_mut(dst, cap) };
    with(inst, 0, |i| lock(&i.tree).html_link_at(id, x, y).map_or(0, |url| write_str(out, &url)))
}

/// Test hook: the focused input, or 0.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_focused(inst: u32) -> u32 {
    with(inst, 0, |i| lock(&i.tree).focused().unwrap_or(0))
}

/// Copies as much of `s` as fits and returns its full length.
fn write_str(out: &mut [u8], s: &str) -> u32 {
    let n = s.len().min(out.len());
    out[..n].copy_from_slice(&s.as_bytes()[..n]);
    s.len() as u32
}

/// Test hook: a wheel scroll at (x, y) logical px by (dx, dy); positive dy scrolls content up.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_wheel(inst: u32, x: f32, y: f32, dx: f32, dy: f32) {
    with(inst, (), |i| {
        if i.headless {
            let _ = i.wheel(x, y, dx, dy);
        } else {
            send(UserEvent::TestWheel(inst, x, y, dx, dy));
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
            i.push_event([ev::RESIZED, width_px, height_px, lock(&i.tree).scale().to_bits()]);
        } else {
            send(UserEvent::Resize(inst, width_px, height_px));
        }
    })
}

/// Advances a headless instance's manual clock by `advance_ms` and does what
/// is due: advances animations, and lays out if anything changed. Returns flags: bit 0 = events are
/// waiting for `mt_take_events`, bit 1 = a layout ran.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_step(inst: u32, advance_ms: f64) -> u32 {
    with(inst, 0, |i| {
        let mut ran = false;
        if i.headless {
            *lock(&i.clock_ms) += advance_ms.max(0.0);
            i.tick();
            ran = i.layout_if_needed();
        }
        (i.events_pending() as u32) | ((ran as u32) << 1)
    })
}

/// Test hook: the cursor the pointer shows now (protocol `cursor`; never AUTO).
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_cursor(inst: u32) -> u32 {
    with(inst, 0, |i| i.cursor())
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
            Offscreen::new().inspect_err(|e| log!("offscreen rendering unavailable: {e}"))
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
                send(UserEvent::Resize(APP, w, h));
            }
        });
    })
}
