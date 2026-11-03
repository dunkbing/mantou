//! Mantou native core: the C ABI loaded by Bun through `bun:ffi`.
//!
//! Threads (DESIGN.md §4–§5):
//!
//! - `mt_run` is called by Bun's **main thread** and runs the winit event loop
//!   there until the app quits. No JavaScript runs on this thread after that.
//! - The app runs in a Bun `Worker`. `mt_commit` runs on the Worker's thread:
//!   it applies the batch to the shadow tree, lays it out and publishes a new
//!   scene, then asks the main thread for a frame.
//! - The main thread draws the latest scene with wgpu, lays out again on
//!   resize, and hit-tests input. Events reach the Worker with one coalesced
//!   wake-up per batch (a threadsafe `JSCallback`) and `mt_take_events`.
//!
//! Every exported function takes scalars, pointers and lengths only (`bun:ffi`
//! cannot pass structs by value), and none lets a panic cross the ABI.

use std::error::Error;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use mantou_render::Renderer;
use mantou_tree::protocol::event as ev;
use mantou_tree::{Scene, Tree};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

/// Bumped on any change to an exported signature or the op/event formats.
/// 2: M1 (shadow tree protocol, PRESS, logical pointer coordinates).
pub const ABI_VERSION: u32 = 2;

/// Named keys travel above the Unicode range.
mod key {
    pub const ESCAPE: u32 = 0x11_0000;
    pub const ENTER: u32 = 0x11_0001;
    pub const OTHER: u32 = 0x11_FFFF;
}

#[derive(Debug)]
enum UserEvent {
    Redraw,
    Quit,
    Resize(u32, u32),
    /// Test input, handled exactly as real pointer input: kind 0 = down, 1 = up, 2 = move.
    TestPointer(u32, f32, f32),
}

#[derive(Default)]
struct Stats {
    frames: AtomicU64,
    commits: AtomicU64,
    wakes: AtomicU64,
    events: AtomicU64,
    resizes: AtomicU64,
    redraw_requests: AtomicU64,
    op_errors: AtomicU64,
    presses: AtomicU64,
}

struct Shared {
    /// The shadow tree. Taken by commits (Worker thread) and resizes (main thread).
    tree: Mutex<Tree>,
    /// The latest scene; drawing never holds the tree lock.
    scene: Mutex<Arc<Scene>>,
    events: Mutex<Vec<u32>>,
    wake_pending: AtomicBool,
    /// `extern "C" fn()` of the threadsafe JSCallback, 0 when none.
    wake: AtomicUsize,
    proxy: Mutex<Option<EventLoopProxy<UserEvent>>>,
    quit_requested: AtomicBool,
    exit_code: AtomicI32,
    info: Mutex<String>,
    stats: Stats,
}

static S: LazyLock<Shared> = LazyLock::new(|| Shared {
    tree: Mutex::new(Tree::new()),
    scene: Mutex::new(Arc::new(Scene { clear: [0.08, 0.08, 0.1, 1.0], ..Scene::default() })),
    events: Mutex::new(Vec::new()),
    wake_pending: AtomicBool::new(false),
    wake: AtomicUsize::new(0),
    proxy: Mutex::new(None),
    quit_requested: AtomicBool::new(false),
    exit_code: AtomicI32::new(0),
    info: Mutex::new(String::new()),
    stats: Stats::default(),
});

/// A poisoned lock only means another entry point panicked; the data is still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn send(ev: UserEvent) -> bool {
    lock(&S.proxy).as_ref().is_some_and(|p| p.send_event(ev).is_ok())
}

fn bump(c: &AtomicU64) {
    c.fetch_add(1, Ordering::Relaxed);
}

/// Queues an event for JS and wakes the Worker, at most once until it takes them.
fn push_event(rec: [u32; 4]) {
    lock(&S.events).extend_from_slice(&rec);
    bump(&S.stats.events);
    wake_js();
}

fn wake_js() {
    if S.wake_pending.swap(true, Ordering::AcqRel) {
        return; // a wake-up is already on its way; the Worker takes everything at once
    }
    let f = S.wake.load(Ordering::Acquire);
    if f == 0 {
        // Nobody to wake yet: mt_set_wake wakes the Worker when it registers.
        S.wake_pending.store(false, Ordering::Release);
        return;
    }
    bump(&S.stats.wakes);
    // SAFETY: `f` was registered by mt_set_wake as a threadsafe JSCallback
    // pointer with the signature `void (*)(void)`. Bun queues the call to the
    // Worker's thread and returns.
    let f: extern "C" fn() = unsafe { std::mem::transmute::<usize, extern "C" fn()>(f) };
    f();
}

/// Lays out if needed and publishes a new scene. Call with the tree locked.
fn publish(tree: &mut Tree) {
    tree.layout();
    *lock(&S.scene) = Arc::new(tree.scene());
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

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn mt_abi_version() -> u32 {
    ABI_VERSION
}

/// Registers the Worker's wake-up callback (a threadsafe JSCallback).
#[unsafe(no_mangle)]
pub extern "C" fn mt_set_wake(f: Option<extern "C" fn()>) {
    guard((), || {
        S.wake.store(f.map_or(0, |f| f as usize), Ordering::Release);
        if f.is_some() && !lock(&S.events).is_empty() {
            wake_js();
        }
    })
}

/// Applies a batch of ops (one per JS turn), lays out, publishes the scene and
/// asks the main thread for a frame. Returns 0, or -1 for a malformed batch,
/// which is rejected whole. Ops that make no sense (unknown ids…) are skipped
/// and counted in the stats (`op_errors`).
///
/// # Safety
/// `ptr` must be valid for `len` bytes for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_commit(ptr: *const u8, len: u32) -> i32 {
    // SAFETY: guaranteed by the caller.
    let b = unsafe { bytes(ptr, len) };
    guard(-99, || {
        let mut tree = lock(&S.tree);
        match tree.apply(b) {
            Ok(report) => {
                for e in &report.errors {
                    eprintln!("mantou-core: op skipped: {e}");
                }
                S.stats.op_errors.fetch_add(report.errors.len() as u64, Ordering::Relaxed);
            }
            Err(e) => {
                eprintln!("mantou-core: batch rejected: {e}");
                return -1;
            }
        }
        publish(&mut tree);
        drop(tree);
        bump(&S.stats.commits);
        if send(UserEvent::Redraw) {
            bump(&S.stats.redraw_requests);
        }
        0
    })
}

/// Copies whole queued event records into `dst` (at most `cap` bytes) and
/// returns the number of bytes written. Call again while it returns a full buffer.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_take_events(dst: *mut u8, cap: u32) -> u32 {
    guard(0, || {
        // Clear before taking: an event pushed after this point either lands in
        // this take or wakes the Worker again, so none is ever stranded.
        S.wake_pending.store(false, Ordering::Release);
        if dst.is_null() {
            return 0;
        }
        let mut q = lock(&S.events);
        let n_words = q.len().min((cap as usize / 16) * 4);
        // SAFETY: `dst` is valid for `cap` bytes and n_words * 4 <= cap.
        let out = unsafe { std::slice::from_raw_parts_mut(dst, n_words * 4) };
        for (chunk, word) in out.chunks_exact_mut(4).zip(q.drain(..n_words)) {
            chunk.copy_from_slice(&word.to_le_bytes());
        }
        (n_words * 4) as u32
    })
}

/// Writes up to `cap` counters into `dst` and returns how many it wrote:
/// frames, commits, wakes, events, resizes, redraw requests, layouts, ops,
/// op errors, quads (last scene), nodes, presses.
///
/// # Safety
/// `dst` must be valid for writes of `cap` u64 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_stats(dst: *mut u64, cap: u32) -> u32 {
    guard(0, || {
        let st = &S.stats;
        let (layouts, ops, nodes) = {
            let t = lock(&S.tree);
            (t.stats().layouts, t.stats().ops, t.node_count() as u64)
        };
        let quads = lock(&S.scene).quads.len() as u64;
        let load = |c: &AtomicU64| c.load(Ordering::Relaxed);
        let all = [
            load(&st.frames),
            load(&st.commits),
            load(&st.wakes),
            load(&st.events),
            load(&st.resizes),
            load(&st.redraw_requests),
            layouts,
            ops,
            load(&st.op_errors),
            quads,
            nodes,
            load(&st.presses),
        ];
        let n = all.len().min(cap as usize);
        if dst.is_null() {
            return 0;
        }
        for (i, v) in all.iter().take(n).enumerate() {
            // SAFETY: i < n <= cap.
            unsafe { *dst.add(i) = *v };
        }
        n as u32
    })
}

/// Writes a UTF-8 description of the GPU adapter and OS into `dst`.
///
/// # Safety
/// `dst` must be valid for writes of `cap` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_info(dst: *mut u8, cap: u32) -> u32 {
    guard(0, || {
        let info = lock(&S.info);
        let n = info.len().min(cap as usize);
        if !dst.is_null() {
            // SAFETY: n <= cap.
            unsafe { std::ptr::copy_nonoverlapping(info.as_ptr(), dst, n) };
        }
        n as u32
    })
}

/// Test hook: from a native thread, asks the main thread to resize the window
/// `count` times, `interval_ms` apart, alternating between two sizes. It runs
/// even while the Worker is busy.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_resize(count: u32, interval_ms: u32, w0: u32, h0: u32, w1: u32, h1: u32) {
    guard((), || {
        std::thread::spawn(move || {
            for i in 0..count {
                std::thread::sleep(Duration::from_millis(interval_ms as u64));
                let (w, h) = if i % 2 == 0 { (w0, h0) } else { (w1, h1) };
                send(UserEvent::Resize(w, h));
            }
        });
    })
}

/// Test hook: pointer input at (x, y) in logical px, handled on the main thread
/// exactly as the window's own input. kind: 0 = down, 1 = up, 2 = move.
#[unsafe(no_mangle)]
pub extern "C" fn mt_test_pointer(kind: u32, x: f32, y: f32) {
    guard((), || {
        send(UserEvent::TestPointer(kind, x, y));
    })
}

/// Test hook: writes the node's box (x0, y0, x1, y1, logical px, last layout)
/// into `dst[0..4]`. Returns 0, or -1 when the node isn't laid out.
///
/// # Safety
/// `dst` must be valid for writes of 4 f32 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mt_test_node_rect(id: u32, dst: *mut f32) -> i32 {
    guard(-1, || {
        let Some(r) = lock(&S.tree).rect(id) else { return -1 };
        if dst.is_null() {
            return -1;
        }
        // SAFETY: dst is valid for 4 f32 writes.
        unsafe { std::ptr::copy_nonoverlapping(r.as_ptr(), dst, 4) };
        0
    })
}

/// Asks the event loop to end; `mt_run` then returns `code`.
#[unsafe(no_mangle)]
pub extern "C" fn mt_quit(code: i32) {
    guard((), || {
        S.exit_code.store(code, Ordering::Release);
        S.quit_requested.store(true, Ordering::Release);
        send(UserEvent::Quit);
    })
}

/// Runs the native event loop on the calling thread, which must be the
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
        let config = Config::parse(b);
        let event_loop = match EventLoop::<UserEvent>::with_user_event().build() {
            Ok(el) => el,
            Err(e) => {
                eprintln!("mantou-core: cannot start the event loop: {e}");
                return 102;
            }
        };
        event_loop.set_control_flow(ControlFlow::Wait);
        *lock(&S.proxy) = Some(event_loop.create_proxy());
        if S.quit_requested.load(Ordering::Acquire) {
            *lock(&S.proxy) = None;
            return S.exit_code.load(Ordering::Acquire);
        }
        let mut app = App { config, window: None, gpu: None, cursor: (0.0, 0.0), pressed_on: None };
        let result = event_loop.run_app(&mut app);
        *lock(&S.proxy) = None;
        drop(app);
        if let Err(e) = result {
            eprintln!("mantou-core: event loop failed: {e}");
            return 103;
        }
        S.exit_code.load(Ordering::Acquire)
    })
}

// ---------------------------------------------------------------------------
// Main thread
// ---------------------------------------------------------------------------

struct Config {
    width: u32,
    height: u32,
    title: String,
}

impl Config {
    fn parse(b: &[u8]) -> Config {
        let w: Vec<u32> = b[..b.len().min(12)].chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let get = |i: usize, d: u32| w.get(i).copied().unwrap_or(d);
        let n = get(2, 0) as usize;
        let title = b.get(12..12 + n).and_then(|t| std::str::from_utf8(t).ok()).unwrap_or("Mantou");
        Config { width: get(0, 800).max(1), height: get(1, 600).max(1), title: title.to_owned() }
    }
}

struct Gpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
}

impl Gpu {
    fn new(el: &ActiveEventLoop, window: Arc<Window>) -> Result<(Gpu, String), Box<dyn Error>> {
        // The display handle matters for OpenGL (EGL); Vulkan, Metal and D3D12 ignore it.
        let display = Box::new(el.owned_display_handle());
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle_from_env(display));
        let surface = instance.create_surface(window.clone())?;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            force_fallback_adapter: false,
            compatible_surface: Some(&surface),
            ..Default::default()
        }))?;
        let info = adapter.get_info();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("mantou"),
            required_limits: wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits()),
            ..Default::default()
        }))?;
        let size = window.inner_size();
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .ok_or("the surface is not supported by the adapter")?;
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&device, &config);
        let renderer = Renderer::new(&device, config.format);
        let desc = format!("{} ({:?}, {:?})", info.name, info.backend, info.device_type);
        Ok((Gpu { surface, device, queue, config, renderer }, desc))
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width > 0 && size.height > 0 {
            self.config.width = size.width;
            self.config.height = size.height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    fn draw(&mut self, scene: &Scene) -> bool {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return false;
            }
            other => {
                eprintln!("mantou-core: no surface texture: {other:?}");
                return false;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let size = (self.config.width, self.config.height);
        let commands = self.renderer.draw(&self.device, &self.queue, &view, size, scene);
        self.queue.submit([commands]);
        self.queue.present(frame);
        true
    }
}

struct App {
    config: Config,
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
    /// Pointer position, logical px.
    cursor: (f32, f32),
    /// The press target under the pointer when the primary button went down.
    pressed_on: Option<u32>,
}

impl App {
    fn draw(&mut self) {
        let Some(window) = self.window.clone() else { return };
        if let Some(t) = lock(&S.tree).take_title() {
            window.set_title(&t);
        }
        let scene = lock(&S.scene).clone();
        let Some(gpu) = self.gpu.as_mut() else { return };
        window.pre_present_notify();
        if gpu.draw(&scene) {
            bump(&S.stats.frames);
        } else {
            window.request_redraw();
        }
    }

    fn relayout(&mut self, size: PhysicalSize<u32>, scale: f32) {
        let mut tree = lock(&S.tree);
        tree.set_viewport(size.width, size.height, scale);
        publish(&mut tree);
    }

    fn scale(&self) -> f32 {
        self.window.as_ref().map_or(1.0, |w| w.scale_factor() as f32)
    }

    fn pointer(&mut self, kind: u32, x: f32, y: f32) {
        self.cursor = (x, y);
        match kind {
            0 => {
                self.pressed_on = lock(&S.tree).press_target(x, y);
                push_event([ev::POINTER_DOWN, 0, x.to_bits(), y.to_bits()]);
            }
            1 => {
                let target = lock(&S.tree).press_target(x, y);
                push_event([ev::POINTER_UP, 0, x.to_bits(), y.to_bits()]);
                if let Some(t) = target.filter(|t| self.pressed_on == Some(*t)) {
                    bump(&S.stats.presses);
                    push_event([ev::PRESS, t, x.to_bits(), y.to_bits()]);
                }
                self.pressed_on = None;
            }
            _ => push_event([ev::POINTER_MOVE, 0, x.to_bits(), y.to_bits()]),
        }
    }
}

fn button_code(b: MouseButton) -> u32 {
    match b {
        MouseButton::Left => 0,
        MouseButton::Middle => 1,
        MouseButton::Right => 2,
        MouseButton::Back => 3,
        MouseButton::Forward => 4,
        MouseButton::Other(n) => 5 + n as u32,
    }
}

fn key_code(k: &Key) -> u32 {
    match k {
        Key::Named(NamedKey::Escape) => key::ESCAPE,
        Key::Named(NamedKey::Enter) => key::ENTER,
        Key::Character(s) => s.chars().next().map_or(key::OTHER, |c| c as u32),
        _ => key::OTHER,
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title(self.config.title.clone())
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height));
        let window = match el.create_window(attrs) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                eprintln!("mantou-core: cannot create a window: {e}");
                S.exit_code.store(104, Ordering::Release);
                el.exit();
                return;
            }
        };
        match Gpu::new(el, window.clone()) {
            Ok((gpu, desc)) => {
                *lock(&S.info) = format!("{desc}; {}", std::env::consts::OS);
                self.gpu = Some(gpu);
            }
            Err(e) => {
                eprintln!("mantou-core: GPU unavailable, nothing will be drawn: {e}");
                *lock(&S.info) = format!("no GPU ({e}); {}", std::env::consts::OS);
            }
        }
        let size = window.inner_size();
        let scale = window.scale_factor() as f32;
        self.window = Some(window.clone());
        self.relayout(size, scale);
        push_event([ev::WINDOW_READY, size.width, size.height, scale.to_bits()]);
        window.request_redraw();
    }

    fn user_event(&mut self, el: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Redraw => {
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            UserEvent::Quit => el.exit(),
            UserEvent::Resize(w, h) => {
                if let Some(win) = &self.window {
                    let _ = win.request_inner_size(PhysicalSize::new(w, h));
                }
            }
            UserEvent::TestPointer(kind, x, y) => self.pointer(kind, x, y),
        }
    }

    fn window_event(&mut self, _el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => push_event([ev::CLOSE_REQUESTED, 0, 0, 0]),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    gpu.resize(size);
                }
                // Lay out at the new size before drawing, without waiting for JS.
                let scale = self.scale();
                self.relayout(size, scale);
                bump(&S.stats.resizes);
                push_event([ev::RESIZED, size.width, size.height, 0]);
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                if let Some(w) = &self.window {
                    self.relayout(w.inner_size(), scale_factor as f32);
                }
                push_event([ev::SCALE_CHANGED, 0, 0, (scale_factor as f32).to_bits()]);
            }
            WindowEvent::CursorMoved { position, .. } => {
                let p: PhysicalPosition<f64> = position;
                let s = self.scale();
                self.pointer(2, p.x as f32 / s, p.y as f32 / s);
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let (x, y) = self.cursor;
                if button == MouseButton::Left {
                    self.pointer(if state == ElementState::Pressed { 0 } else { 1 }, x, y);
                } else {
                    let kind = if state == ElementState::Pressed { ev::POINTER_DOWN } else { ev::POINTER_UP };
                    push_event([kind, button_code(button), x.to_bits(), y.to_bits()]);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let kind = if event.state == ElementState::Pressed { ev::KEY_DOWN } else { ev::KEY_UP };
                push_event([kind, key_code(&event.logical_key), event.repeat as u32, 0]);
            }
            WindowEvent::RedrawRequested => self.draw(),
            _ => {}
        }
    }
}
