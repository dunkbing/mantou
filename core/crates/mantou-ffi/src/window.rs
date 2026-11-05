//! The window: winit on Bun's main thread, drawing the app instance's scene
//! with wgpu, laying out again on resize and turning input into events.

use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use mantou_render::Renderer;
use mantou_tree::Scene;
use mantou_tree::protocol::{cursor, event as ev};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalPosition, LogicalSize, PhysicalSize};
use winit::event::{ElementState, Ime, MouseButton, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::window::CursorIcon;
use winit::keyboard::{Key, NamedKey};
use winit::window::{ImePurpose, Window, WindowId};

use crate::instance::{Instance, bump, lock};
use crate::{G, UserEvent, app, guard, key_text};

use mantou_tree::WindowLimits;
use mantou_tree::protocol::{key_modifier, named_key as key, window_flag};
use winit::event::MouseScrollDelta;
use winit::keyboard::ModifiersState;

/// Pixels per wheel line.
const LINE: f32 = 40.0;

#[derive(Debug)]
pub struct Config {
    pub width: u32,
    pub height: u32,
    pub title: String,
    pub limits: WindowLimits,
    /// `window_flag` bits.
    pub flags: u32,
    pub position: Option<(i32, i32)>,
}

impl Config {
    /// `[width, height, titleLen, minWidth, minHeight, maxWidth, maxHeight, flags, x, y]`
    /// as u32 words (sizes in logical px, 0 = no limit; flags: `window_flag`),
    /// then the title's UTF-8 bytes.
    pub fn parse(b: &[u8]) -> Config {
        const WORDS: usize = 10;
        let w: Vec<u32> = b[..b.len().min(WORDS * 4)].chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let get = |i: usize, d: u32| w.get(i).copied().unwrap_or(d);
        let n = get(2, 0) as usize;
        let title = b.get(WORDS * 4..WORDS * 4 + n).and_then(|t| std::str::from_utf8(t).ok()).unwrap_or("Mantou");
        let limits = WindowLimits {
            min: [get(3, 0) as f32, get(4, 0) as f32],
            max: [get(5, 0) as f32, get(6, 0) as f32],
            resizable: get(7, 0) & window_flag::NOT_RESIZABLE == 0,
        };
        let flags = get(7, 0);
        let position = (flags & window_flag::HAS_POSITION != 0).then(|| (get(8, 0) as i32, get(9, 0) as i32));
        Config { width: get(0, 800).max(1), height: get(1, 600).max(1), title: title.to_owned(), limits, flags, position }
    }
}

/// Applies size limits (logical px, 0 = none) to the window.
fn apply_limits(window: &Window, l: &WindowLimits) {
    let size = |v: [f32; 2]| (v[0] > 0.0 || v[1] > 0.0).then(|| LogicalSize::new(v[0].max(1.0), v[1].max(1.0)));
    window.set_min_inner_size(size(l.min));
    // A max of 0 on one axis means no limit on it.
    let max = (l.max[0] > 0.0 || l.max[1] > 0.0).then(|| LogicalSize::new(if l.max[0] > 0.0 { l.max[0] } else { 1e6 }, if l.max[1] > 0.0 { l.max[1] } else { 1e6 }));
    window.set_max_inner_size(max);
    window.set_resizable(l.resizable);
}

/// The GPU device every window draws with, opened with the first window.
struct Shared {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
}

/// A window's surface, and its renderer (its own atlas and image textures, since each window has its own tree).
struct Gpu {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
}

impl Shared {
    /// Opens the device for `window`'s surface; returns the surface too, and a description of the GPU.
    fn new(el: &ActiveEventLoop, window: Arc<Window>) -> Result<(Shared, wgpu::Surface<'static>, String), Box<dyn Error>> {
        // The display handle matters for OpenGL (EGL); Vulkan, Metal and D3D12 ignore it.
        let display = Box::new(el.owned_display_handle());
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle_from_env(display));
        let surface = instance.create_surface(window)?;
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
        let desc = format!("{} ({:?}, {:?})", info.name, info.backend, info.device_type);
        Ok((Shared { instance, adapter, device, queue }, surface, desc))
    }
}

impl Gpu {
    fn new(shared: &Shared, surface: wgpu::Surface<'static>, window: &Window) -> Result<Gpu, Box<dyn Error>> {
        let size = window.inner_size();
        let mut config = surface
            .get_default_config(&shared.adapter, size.width.max(1), size.height.max(1))
            .ok_or("the surface is not supported by the adapter")?;
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&shared.device, &config);
        let renderer = Renderer::new(&shared.device, config.format);
        Ok(Gpu { surface, config, renderer })
    }

    fn resize(&mut self, shared: &Shared, size: PhysicalSize<u32>) {
        if size.width > 0 && size.height > 0 {
            self.config.width = size.width;
            self.config.height = size.height;
            self.surface.configure(&shared.device, &self.config);
        }
    }

    fn draw(&mut self, shared: &Shared, scene: &Scene) -> Drawn {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&shared.device, &self.config);
                return Drawn::Retry;
            }
            // Not ready yet: skip this frame (wgpu's advice) and try the next.
            wgpu::CurrentSurfaceTexture::Timeout => return Drawn::Retry,
            // Hidden: draw again when the window shows (WindowEvent::Occluded(false)).
            wgpu::CurrentSurfaceTexture::Occluded => return Drawn::Skipped,
            other => {
                log!("no surface texture: {other:?}");
                return Drawn::Skipped;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let size = (self.config.width, self.config.height);
        let commands = self.renderer.draw(&shared.device, &shared.queue, &view, size, scene);
        shared.queue.submit([commands]);
        shared.queue.present(frame);
        Drawn::Yes
    }
}

enum Drawn {
    Yes,
    /// Not this time: ask for another frame.
    Retry,
    /// Not until something changes.
    Skipped,
}

/// Secure keyboard entry (macOS): while it's on, other processes can't read the keys typed.
/// winit leaves `set_ime_purpose` empty on macOS, so the window asks Carbon itself.
#[cfg(target_os = "macos")]
mod secure_keys {
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn EnableSecureEventInput() -> i32;
        fn DisableSecureEventInput() -> i32;
    }
    /// Counted by the OS per process: call with the state that changed, never twice in a row.
    pub fn set(on: bool) {
        // SAFETY: plain Carbon calls with no arguments, made on the main thread.
        unsafe {
            if on { EnableSecureEventInput() } else { DisableSecureEventInput() };
        }
    }
}
#[cfg(not(target_os = "macos"))]
mod secure_keys {
    pub fn set(_on: bool) {}
}

/// One window: its instance, its surface and what the window tells the OS.
struct Win {
    inst: Arc<Instance>,
    window: Arc<Window>,
    gpu: Option<Gpu>,
    /// Whether the IME is on: while an input has the focus.
    ime: bool,
    /// Whether the window told the OS a password field has the focus.
    ime_password: bool,
    /// The AccessKit adapter: tells screen readers about the tree while one is running.
    access: Option<accesskit_winit::Adapter>,
    /// The window is the key window.
    focused: bool,
    /// Files held over the window, and how many more DroppedFile events belong to the drop already sent.
    dragging: Vec<String>,
    last_state: Option<(u32, i32, i32)>,
    skip_drops: usize,
    /// The cursor shown (protocol `cursor`).
    cursor: u32,
}

/// The app's windows (design §10, dunkbing/mantou#23): the first is the
/// window instance's (handle 1, from `mt_run`); the app opens more with
/// `mt_window_open`, each with an instance of its own. They share the GPU
/// device; each has its own surface and renderer.
pub struct App {
    config: Config,
    wins: HashMap<WindowId, Win>,
    by_handle: HashMap<u32, WindowId>,
    gpu: Option<Shared>,
    modifiers: u32,
    menus: crate::platform::Menus,
    /// Secure keyboard entry is on (a password field has the focus in the key window).
    secure_keys: bool,
}

/// winit's cursor for a `cursor` style value.
fn cursor_icon(c: u32) -> CursorIcon {
    match c {
        cursor::POINTER => CursorIcon::Pointer,
        cursor::TEXT => CursorIcon::Text,
        cursor::GRAB => CursorIcon::Grab,
        cursor::GRABBING => CursorIcon::Grabbing,
        cursor::NOT_ALLOWED => CursorIcon::NotAllowed,
        cursor::MOVE => CursorIcon::Move,
        cursor::CROSSHAIR => CursorIcon::Crosshair,
        cursor::WAIT => CursorIcon::Wait,
        cursor::PROGRESS => CursorIcon::Progress,
        cursor::HELP => CursorIcon::Help,
        cursor::EW_RESIZE => CursorIcon::EwResize,
        cursor::NS_RESIZE => CursorIcon::NsResize,
        cursor::NESW_RESIZE => CursorIcon::NeswResize,
        cursor::NWSE_RESIZE => CursorIcon::NwseResize,
        cursor::COL_RESIZE => CursorIcon::ColResize,
        cursor::ROW_RESIZE => CursorIcon::RowResize,
        _ => CursorIcon::Default,
    }
}

impl Win {
    fn redraw_if(&self, changed: bool) {
        if changed {
            self.window.request_redraw();
        }
    }

    fn scale(&self) -> f32 {
        self.window.scale_factor() as f32
    }

    /// Shows the cursor the tree asks for, if it changed (the window keeps it until told otherwise).
    fn sync_cursor(&mut self) {
        let c = self.inst.cursor();
        if c == self.cursor {
            return;
        }
        self.cursor = c;
        self.window.set_cursor_visible(c != cursor::NONE);
        self.window.set_cursor(cursor_icon(c));
    }

    /// Turns the IME on while an input has the focus, and puts its candidate window at the caret.
    fn sync_ime(&mut self) {
        let (area, secure) = {
            let mut tree = lock(&self.inst.tree);
            (tree.focused().and(tree.ime_area()), tree.focused_is_secure())
        };
        if area.is_some() != self.ime {
            self.ime = area.is_some();
            self.window.set_ime_allowed(self.ime);
        }
        // A password field: the platforms that support it turn composition
        // and suggestions off (winit's ImePurpose).
        if secure != self.ime_password {
            self.ime_password = secure;
            self.window.set_ime_purpose(if secure { ImePurpose::Password } else { ImePurpose::Normal });
        }
        if let Some([x0, y0, x1, y1]) = area {
            self.window.set_ime_cursor_area(LogicalPosition::new(x0, y0), LogicalSize::new((x1 - x0).max(1.0), (y1 - y0).max(1.0)));
        }
    }

    /// Sends the accessibility tree to the adapter, if a screen reader is running and the tree may have changed.
    fn sync_access(&mut self, force: bool) {
        if !(self.inst.access_dirty.swap(false, Ordering::AcqRel) || force) {
            return;
        }
        let inst = self.inst.clone();
        if let Some(a) = self.access.as_mut() {
            a.update_if_active(|| lock(&inst.tree).accessibility());
        }
    }

    /// Tells JS when the window's focus, position or minimized, maximized or full screen state changed.
    fn sync_state(&mut self) {
        let s = crate::platform::window_state(&self.window);
        if self.last_state != Some(s) {
            self.last_state = Some(s);
            self.inst.push_event([ev::WINDOW_STATE, s.0, s.1 as u32, s.2 as u32]);
        }
    }

    fn draw(&mut self, shared: Option<&Shared>) {
        let (title, size, limits) = {
            let mut tree = lock(&self.inst.tree);
            (tree.take_title(), tree.take_window_size(), tree.take_window_limits())
        };
        if let Some(t) = title {
            self.window.set_title(&t);
        }
        if let Some(l) = limits {
            apply_limits(&self.window, &l);
        }
        if let Some([w, h]) = size {
            let _ = self.window.request_inner_size(LogicalSize::new(w, h));
        }
        self.sync_ime();
        self.sync_access(false);
        self.sync_cursor();
        // Animations advance once a frame, on the main thread, with no JS;
        // while any runs, the next frame is asked for (vsync paces them).
        let animating = self.inst.tick();
        let scene = lock(&self.inst.scene).clone();
        let (Some(gpu), Some(shared)) = (self.gpu.as_mut(), shared) else { return };
        self.window.pre_present_notify();
        match gpu.draw(shared, &scene) {
            Drawn::Yes => bump(&self.inst.stats.frames),
            Drawn::Retry => self.window.request_redraw(),
            Drawn::Skipped => {}
        }
        if animating {
            self.window.request_redraw();
        }
    }
}

impl App {
    pub fn new(config: Config) -> App {
        App { config, wins: HashMap::new(), by_handle: HashMap::new(), gpu: None, modifiers: 0, menus: Default::default(), secure_keys: false }
    }

    fn win(&mut self, handle: u32) -> Option<&mut Win> {
        let id = self.by_handle.get(&handle)?;
        self.wins.get_mut(id)
    }

    /// Secure keyboard entry follows "a password field has the focus in the key window".
    fn sync_secure_keys(&mut self) {
        let want = self.wins.values().any(|w| w.ime_password && w.focused);
        if want != self.secure_keys {
            self.secure_keys = want;
            secure_keys::set(want);
        }
    }

    /// Opens a window for the instance `handle`, as `config` says; tells its app with WINDOW_READY.
    fn open(&mut self, el: &ActiveEventLoop, handle: u32, inst: Arc<Instance>, config: &Config) -> bool {
        let mut attrs = Window::default_attributes()
            .with_visible(false) // the AccessKit adapter must exist before the window is shown
            .with_title(config.title.clone())
            .with_inner_size(LogicalSize::new(config.width, config.height))
            .with_decorations(config.flags & window_flag::FRAMELESS == 0)
            .with_maximized(config.flags & window_flag::MAXIMIZED != 0);
        #[cfg(target_os = "macos")]
        if config.flags & window_flag::TITLE_OVERLAY != 0 {
            use winit::platform::macos::WindowAttributesExtMacOS;
            // Content under a transparent title bar; the traffic lights stay.
            attrs = attrs.with_titlebar_transparent(true).with_fullsize_content_view(true).with_title_hidden(true);
        }
        if config.flags & window_flag::ALWAYS_ON_TOP != 0 {
            attrs = attrs.with_window_level(winit::window::WindowLevel::AlwaysOnTop);
        }
        if config.flags & window_flag::FULLSCREEN != 0 {
            attrs = attrs.with_fullscreen(Some(winit::window::Fullscreen::Borderless(None)));
        }
        if let Some((x, y)) = config.position {
            attrs = attrs.with_position(winit::dpi::LogicalPosition::new(x, y));
        }
        let window = match el.create_window(attrs) {
            Ok(w) => {
                apply_limits(&w, &config.limits);
                Arc::new(w)
            }
            Err(e) => {
                log!("cannot create a window: {e}");
                return false;
            }
        };
        // The first window opens the GPU device; the others make surfaces on it.
        let surface = match &self.gpu {
            Some(shared) => shared.instance.create_surface(window.clone()).map_err(|e| e.to_string()),
            None => match Shared::new(el, window.clone()) {
                Ok((shared, surface, desc)) => {
                    *lock(&G.info) = format!("{desc}; {}", std::env::consts::OS);
                    self.gpu = Some(shared);
                    Ok(surface)
                }
                Err(e) => Err(e.to_string()),
            },
        };
        let gpu = match surface.and_then(|s| Gpu::new(self.gpu.as_ref().expect("opened"), s, &window).map_err(|e| e.to_string())) {
            Ok(g) => Some(g),
            Err(e) => {
                log!("GPU unavailable, nothing will be drawn: {e}");
                if self.gpu.is_none() {
                    *lock(&G.info) = format!("no GPU ({e}); {}", std::env::consts::OS);
                }
                None
            }
        };
        let access = lock(&G.proxy).clone().map(|proxy| accesskit_winit::Adapter::with_event_loop_proxy(el, &window, proxy));
        window.set_visible(true);
        let size = window.inner_size();
        let scale = window.scale_factor() as f32;
        inst.relayout(size.width, size.height, scale);
        inst.push_event([ev::WINDOW_READY, size.width, size.height, scale.to_bits()]);
        let id = window.id();
        let mut win = Win { inst, window, gpu, ime: false, ime_password: false, access, focused: true, dragging: Vec::new(), last_state: None, skip_drops: 0, cursor: cursor::DEFAULT };
        win.sync_state();
        win.window.request_redraw();
        self.wins.insert(id, win);
        self.by_handle.insert(handle, id);
        true
    }

    /// Closes a window the app opened, and drops its instance.
    fn close(&mut self, handle: u32) {
        let Some(id) = self.by_handle.remove(&handle) else { return };
        self.wins.remove(&id); // the window, its surface and its adapter go with it
        crate::forget(handle);
        self.sync_secure_keys();
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
        Key::Named(n) => match n {
            NamedKey::Escape => key::ESCAPE,
            NamedKey::Enter => key::ENTER,
            NamedKey::ArrowUp => key::ARROW_UP,
            NamedKey::ArrowDown => key::ARROW_DOWN,
            NamedKey::ArrowLeft => key::ARROW_LEFT,
            NamedKey::ArrowRight => key::ARROW_RIGHT,
            NamedKey::Backspace => key::BACKSPACE,
            NamedKey::Delete => key::DELETE,
            NamedKey::Tab => key::TAB,
            NamedKey::Home => key::HOME,
            NamedKey::End => key::END,
            NamedKey::PageUp => key::PAGE_UP,
            NamedKey::PageDown => key::PAGE_DOWN,
            NamedKey::Space => ' ' as u32,
            _ => key::UNIDENTIFIED,
        },
        Key::Character(s) => s.chars().next().map_or(key::UNIDENTIFIED, |c| c as u32),
        _ => key::UNIDENTIFIED,
    }
}

fn modifier_bits(m: ModifiersState) -> u32 {
    (if m.shift_key() { key_modifier::SHIFT } else { 0 })
        | (if m.control_key() { key_modifier::CONTROL } else { 0 })
        | (if m.alt_key() { key_modifier::ALT } else { 0 })
        | (if m.super_key() { key_modifier::META } else { 0 })
}

// Each handler catches its own panics: one bad event is logged, and the
// window keeps running.
impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        guard((), || self.on_resumed(el));
    }

    fn user_event(&mut self, el: &ActiveEventLoop, event: UserEvent) {
        guard((), || self.on_user_event(el, event));
    }

    fn window_event(&mut self, el: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        guard((), || self.on_window_event(el, id, event));
    }
}

impl App {
    fn on_resumed(&mut self, el: &ActiveEventLoop) {
        if self.by_handle.contains_key(&crate::APP) {
            return;
        }
        let config = std::mem::replace(&mut self.config, Config::parse(&[]));
        if !self.open(el, crate::APP, app(), &config) {
            G.exit_code.store(104, Ordering::Release);
            el.exit();
            return;
        }
        self.menus.install_default(&app());
    }

    fn on_user_event(&mut self, el: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Redraw(h) => {
                if let Some(w) = self.win(h) {
                    w.window.request_redraw();
                }
            }
            UserEvent::Quit => el.exit(),
            UserEvent::OpenWindow(h, config) => {
                if let Some(inst) = crate::instance(h)
                    && !self.open(el, h, inst.clone(), &config)
                {
                    inst.push_event([ev::CLOSE_REQUESTED, 0, 0, 0]); // it never opened: the app hears it's gone
                }
            }
            UserEvent::CloseWindow(h) => self.close(h),
            UserEvent::FocusWindow(h) => {
                if let Some(w) = self.win(h) {
                    w.window.focus_window();
                }
            }
            UserEvent::Resize(h, w, hh) => {
                if let Some(win) = self.win(h) {
                    let _ = win.window.request_inner_size(PhysicalSize::new(w, hh));
                }
            }
            UserEvent::TestPointer(h, kind, x, y) => {
                if let Some(w) = self.win(h) {
                    w.redraw_if(w.inst.pointer(kind, x, y));
                    w.sync_cursor();
                }
            }
            UserEvent::TestKey(h, k, down, mods) => {
                if let Some(w) = self.win(h) {
                    w.redraw_if(w.inst.key(k, key_text(k).as_deref(), down, false, mods));
                }
            }
            UserEvent::TestWheel(h, x, y, dx, dy) => {
                if let Some(w) = self.win(h) {
                    w.redraw_if(w.inst.wheel(x, y, dx, dy));
                }
            }
            UserEvent::TestText(h, t) => {
                if let Some(w) = self.win(h) {
                    w.redraw_if(w.inst.insert_text(&t));
                }
            }
            UserEvent::TestIme(h, t, cursor) => {
                if let Some(w) = self.win(h) {
                    w.redraw_if(w.inst.ime_preedit(&t, cursor));
                }
            }
            UserEvent::Access(e) => {
                let Some(w) = self.wins.get_mut(&e.window_id) else { return };
                match e.window_event {
                    accesskit_winit::WindowEvent::InitialTreeRequested => w.sync_access(true),
                    accesskit_winit::WindowEvent::ActionRequested(req) => w.redraw_if(w.inst.access_action(req)),
                    accesskit_winit::WindowEvent::AccessibilityDeactivated => {}
                }
            }
            UserEvent::Service(h, req, body) => {
                let Some(inst) = crate::instance(h) else { return };
                let id = self.by_handle.get(&h).copied();
                let window = id.and_then(|id| self.wins.get(&id)).map(|w| w.window.clone());
                guard((), || crate::platform::handle(&inst, window.as_ref(), &mut self.menus, req, &body));
                if let Some(w) = id.and_then(|id| self.wins.get_mut(&id)) {
                    w.sync_state();
                }
            }
        }
    }

    fn on_window_event(&mut self, _el: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let modifiers = self.modifiers;
        let shared = self.gpu.as_ref();
        let Some(w) = self.wins.get_mut(&id) else { return };
        if let Some(a) = w.access.as_mut() {
            a.process_event(&w.window, &event);
        }
        let inst = w.inst.clone();
        match event {
            WindowEvent::Moved(_) | WindowEvent::ThemeChanged(_) => w.sync_state(),
            WindowEvent::CloseRequested => inst.push_event([ev::CLOSE_REQUESTED, 0, 0, 0]),
            WindowEvent::Resized(size) => {
                if let (Some(gpu), Some(shared)) = (w.gpu.as_mut(), shared) {
                    gpu.resize(shared, size);
                }
                // Lay out at the new size before drawing, without waiting for JS.
                inst.relayout(size.width, size.height, w.scale());
                bump(&inst.stats.resizes);
                inst.push_event([ev::RESIZED, size.width, size.height, w.scale().to_bits()]);
                w.sync_state();
                w.window.request_redraw();
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                let size = w.window.inner_size();
                inst.relayout(size.width, size.height, scale_factor as f32);
                inst.push_event([ev::SCALE_CHANGED, 0, 0, (scale_factor as f32).to_bits()]);
            }
            WindowEvent::CursorMoved { position, .. } => {
                let s = w.scale();
                w.redraw_if(inst.pointer(2, position.x as f32 / s, position.y as f32 / s));
                w.sync_cursor();
            }
            WindowEvent::HoveredFile(p) => {
                w.dragging.push(p.to_string_lossy().into_owned());
                if w.dragging.len() == 1 {
                    inst.file_drop(0, &w.dragging);
                }
            }
            WindowEvent::HoveredFileCancelled => {
                w.dragging.clear();
                inst.file_drop(1, &[]);
            }
            WindowEvent::DroppedFile(p) => {
                // winit sends one event per file; the held-over list is the whole drop, sent once.
                // ponytail: without a hover list (a platform that skips it) each file is its own drop.
                if !w.dragging.is_empty() {
                    w.skip_drops = w.dragging.len() - 1;
                    inst.file_drop(2, &std::mem::take(&mut w.dragging));
                } else if w.skip_drops > 0 {
                    w.skip_drops -= 1;
                } else {
                    inst.file_drop(2, &[p.to_string_lossy().into_owned()]);
                }
            }
            WindowEvent::CursorLeft { .. } => {
                inst.pointer(3, 0.0, 0.0);
                w.sync_cursor();
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let (x, y) = inst.pointer_position();
                if button == MouseButton::Left {
                    w.redraw_if(inst.pointer(if state == ElementState::Pressed { 0 } else { 1 }, x, y));
                } else {
                    let kind = if state == ElementState::Pressed { ev::POINTER_DOWN } else { ev::POINTER_UP };
                    inst.push_event([kind, button_code(button), x.to_bits(), y.to_bits()]);
                    inst.pointer_button(if state == ElementState::Pressed { 0 } else { 1 }, button_code(button), x, y);
                }
            }
            WindowEvent::ModifiersChanged(m) => {
                self.modifiers = modifier_bits(m.state());
                inst.modifiers.store(self.modifiers, Ordering::Relaxed);
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let down = event.state == ElementState::Pressed;
                let text = event.text.as_ref().map(|t| t.as_str());
                w.redraw_if(inst.key(key_code(&event.logical_key), text, down, event.repeat, modifiers));
            }
            WindowEvent::Ime(ime) => {
                let changed = match ime {
                    Ime::Preedit(text, cursor) => inst.ime_preedit(&text, cursor),
                    Ime::Commit(text) => inst.ime_preedit("", None) | inst.insert_text(&text),
                    Ime::Disabled => inst.ime_preedit("", None),
                    Ime::Enabled => false,
                };
                w.redraw_if(changed);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let (dx, dy) = match delta {
                    MouseScrollDelta::LineDelta(x, y) => (-x * LINE, -y * LINE),
                    MouseScrollDelta::PixelDelta(p) => {
                        let s = w.scale() as f64;
                        ((-p.x / s) as f32, (-p.y / s) as f32)
                    }
                };
                let (x, y) = inst.pointer_position();
                w.redraw_if(inst.wheel(x, y, dx, dy));
            }
            WindowEvent::Focused(f) => {
                w.focused = f;
                w.sync_state();
                self.sync_secure_keys();
            }
            WindowEvent::RedrawRequested => {
                w.draw(shared);
                self.sync_secure_keys();
            }
            WindowEvent::Occluded(false) => w.redraw_if(true),
            _ => {}
        }
    }
}

impl Drop for App {
    fn drop(&mut self) {
        if self.secure_keys {
            secure_keys::set(false);
        }
    }
}
