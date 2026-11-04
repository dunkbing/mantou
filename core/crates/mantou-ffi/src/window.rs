//! The window: winit on Bun's main thread, drawing the app instance's scene
//! with wgpu, laying out again on resize and turning input into events.

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

pub struct Config {
    pub width: u32,
    pub height: u32,
    pub title: String,
    pub limits: WindowLimits,
}

impl Config {
    /// `[width, height, titleLen, minWidth, minHeight, maxWidth, maxHeight, flags]`
    /// as u32 words (sizes in logical px, 0 = no limit; flags: `window_flag`),
    /// then the title's UTF-8 bytes.
    pub fn parse(b: &[u8]) -> Config {
        const WORDS: usize = 8;
        let w: Vec<u32> = b[..b.len().min(WORDS * 4)].chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let get = |i: usize, d: u32| w.get(i).copied().unwrap_or(d);
        let n = get(2, 0) as usize;
        let title = b.get(WORDS * 4..WORDS * 4 + n).and_then(|t| std::str::from_utf8(t).ok()).unwrap_or("Mantou");
        let limits = WindowLimits {
            min: [get(3, 0) as f32, get(4, 0) as f32],
            max: [get(5, 0) as f32, get(6, 0) as f32],
            resizable: get(7, 0) & window_flag::NOT_RESIZABLE == 0,
        };
        Config { width: get(0, 800).max(1), height: get(1, 600).max(1), title: title.to_owned(), limits }
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

    fn draw(&mut self, scene: &Scene) -> Drawn {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
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
        let commands = self.renderer.draw(&self.device, &self.queue, &view, size, scene);
        self.queue.submit([commands]);
        self.queue.present(frame);
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

pub struct App {
    config: Config,
    inst: Arc<Instance>,
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
    modifiers: u32,
    /// Whether the IME is on: while an input has the focus.
    ime: bool,
    /// Whether the window told the OS a password field has the focus.
    ime_password: bool,
    menus: crate::platform::Menus,
    /// The AccessKit adapter: tells screen readers about the tree while one is running.
    access: Option<accesskit_winit::Adapter>,
    /// The window is the key window.
    focused: bool,
    /// Secure keyboard entry is on (a password field has the focus in the key window).
    secure_keys: bool,
    /// Files held over the window, and how many more DroppedFile events belong to the drop already sent.
    dragging: Vec<String>,
    skip_drops: usize,
    /// The cursor shown (protocol `cursor`).
    cursor: u32,
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

impl App {
    pub fn new(config: Config) -> App {
        App { config, inst: app(), window: None, gpu: None, modifiers: 0, ime: false, ime_password: false, menus: Default::default(), access: None, focused: true, secure_keys: false, dragging: Vec::new(), skip_drops: 0, cursor: cursor::DEFAULT }
    }

    fn redraw_if(&self, changed: bool) {
        if changed && let Some(w) = &self.window {
            w.request_redraw();
        }
    }

    /// Shows the cursor the tree asks for, if it changed (the window keeps it until told otherwise).
    fn sync_cursor(&mut self) {
        let Some(window) = &self.window else { return };
        let c = self.inst.cursor();
        if c == self.cursor {
            return;
        }
        self.cursor = c;
        window.set_cursor_visible(c != cursor::NONE);
        window.set_cursor(cursor_icon(c));
    }

    /// Turns the IME on while an input has the focus, and puts its candidate window at the caret.
    fn sync_ime(&mut self, window: &Window) {
        let (area, secure) = {
            let mut tree = lock(&self.inst.tree);
            (tree.focused().and(tree.ime_area()), tree.focused_is_secure())
        };
        if area.is_some() != self.ime {
            self.ime = area.is_some();
            window.set_ime_allowed(self.ime);
        }
        // A password field: the platforms that support it turn composition
        // and suggestions off (winit's ImePurpose).
        if secure != self.ime_password {
            self.ime_password = secure;
            window.set_ime_purpose(if secure { ImePurpose::Password } else { ImePurpose::Normal });
        }
        self.sync_secure_keys();
        if let Some([x0, y0, x1, y1]) = area {
            window.set_ime_cursor_area(LogicalPosition::new(x0, y0), LogicalSize::new((x1 - x0).max(1.0), (y1 - y0).max(1.0)));
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

    /// Secure keyboard entry follows "a password field has the focus in the key window".
    fn sync_secure_keys(&mut self) {
        let want = self.ime_password && self.focused;
        if want != self.secure_keys {
            self.secure_keys = want;
            secure_keys::set(want);
        }
    }

    fn draw(&mut self) {
        let Some(window) = self.window.clone() else { return };
        let (title, size, limits) = {
            let mut tree = lock(&self.inst.tree);
            (tree.take_title(), tree.take_window_size(), tree.take_window_limits())
        };
        if let Some(t) = title {
            window.set_title(&t);
        }
        if let Some(l) = limits {
            apply_limits(&window, &l);
        }
        if let Some([w, h]) = size {
            let _ = window.request_inner_size(LogicalSize::new(w, h));
        }
        self.sync_ime(&window);
        self.sync_access(false);
        self.sync_cursor();
        // Animations advance once a frame, on the main thread, with no JS;
        // while any runs, the next frame is asked for (vsync paces them).
        let animating = self.inst.tick();
        let scene = lock(&self.inst.scene).clone();
        let Some(gpu) = self.gpu.as_mut() else { return };
        window.pre_present_notify();
        match gpu.draw(&scene) {
            Drawn::Yes => bump(&self.inst.stats.frames),
            Drawn::Retry => window.request_redraw(),
            Drawn::Skipped => {}
        }
        if animating {
            window.request_redraw();
        }
    }

    fn scale(&self) -> f32 {
        self.window.as_ref().map_or(1.0, |w| w.scale_factor() as f32)
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
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_visible(false) // the AccessKit adapter must exist before the window is shown
            .with_title(self.config.title.clone())
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height));
        let window = match el.create_window(attrs) {
            Ok(w) => {
                apply_limits(&w, &self.config.limits);
                Arc::new(w)
            }
            Err(e) => {
                log!("cannot create a window: {e}");
                G.exit_code.store(104, Ordering::Release);
                el.exit();
                return;
            }
        };
        match Gpu::new(el, window.clone()) {
            Ok((gpu, desc)) => {
                *lock(&G.info) = format!("{desc}; {}", std::env::consts::OS);
                self.gpu = Some(gpu);
            }
            Err(e) => {
                log!("GPU unavailable, nothing will be drawn: {e}");
                *lock(&G.info) = format!("no GPU ({e}); {}", std::env::consts::OS);
            }
        }
        if let Some(proxy) = lock(&G.proxy).clone() {
            self.access = Some(accesskit_winit::Adapter::with_event_loop_proxy(el, &window, proxy));
        }
        window.set_visible(true);
        let size = window.inner_size();
        let scale = window.scale_factor() as f32;
        self.window = Some(window.clone());
        self.inst.relayout(size.width, size.height, scale);
        self.menus.install_default(&self.inst);
        self.inst.push_event([ev::WINDOW_READY, size.width, size.height, scale.to_bits()]);
        window.request_redraw();
    }

    fn on_user_event(&mut self, el: &ActiveEventLoop, event: UserEvent) {
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
            UserEvent::TestPointer(kind, x, y) => {
                self.redraw_if(self.inst.pointer(kind, x, y));
                self.sync_cursor();
            }
            UserEvent::TestKey(k, down, mods) => self.redraw_if(self.inst.key(k, key_text(k).as_deref(), down, false, mods)),
            UserEvent::TestWheel(x, y, dx, dy) => self.redraw_if(self.inst.wheel(x, y, dx, dy)),
            UserEvent::TestText(t) => self.redraw_if(self.inst.insert_text(&t)),
            UserEvent::TestIme(t, cursor) => self.redraw_if(self.inst.ime_preedit(&t, cursor)),
            UserEvent::Access(e) => match e.window_event {
                accesskit_winit::WindowEvent::InitialTreeRequested => self.sync_access(true),
                accesskit_winit::WindowEvent::ActionRequested(req) => self.redraw_if(self.inst.access_action(req)),
                accesskit_winit::WindowEvent::AccessibilityDeactivated => {}
            },
            UserEvent::Service(req, body) => guard((), || crate::platform::handle(&self.inst, self.window.as_ref(), &mut self.menus, req, &body)),
        }
    }

    fn on_window_event(&mut self, _el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if let (Some(a), Some(w)) = (self.access.as_mut(), self.window.as_ref()) {
            a.process_event(w, &event);
        }
        let inst = self.inst.clone();
        match event {
            WindowEvent::CloseRequested => inst.push_event([ev::CLOSE_REQUESTED, 0, 0, 0]),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    gpu.resize(size);
                }
                // Lay out at the new size before drawing, without waiting for JS.
                inst.relayout(size.width, size.height, self.scale());
                bump(&inst.stats.resizes);
                inst.push_event([ev::RESIZED, size.width, size.height, self.scale().to_bits()]);
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                if let Some(w) = &self.window {
                    let size = w.inner_size();
                    inst.relayout(size.width, size.height, scale_factor as f32);
                }
                inst.push_event([ev::SCALE_CHANGED, 0, 0, (scale_factor as f32).to_bits()]);
            }
            WindowEvent::CursorMoved { position, .. } => {
                let s = self.scale();
                self.redraw_if(inst.pointer(2, position.x as f32 / s, position.y as f32 / s));
                self.sync_cursor();
            }
            WindowEvent::HoveredFile(p) => {
                self.dragging.push(p.to_string_lossy().into_owned());
                if self.dragging.len() == 1 {
                    inst.file_drop(0, &self.dragging);
                }
            }
            WindowEvent::HoveredFileCancelled => {
                self.dragging.clear();
                inst.file_drop(1, &[]);
            }
            WindowEvent::DroppedFile(p) => {
                // winit sends one event per file; the held-over list is the whole drop, sent once.
                // ponytail: without a hover list (a platform that skips it) each file is its own drop.
                if !self.dragging.is_empty() {
                    self.skip_drops = self.dragging.len() - 1;
                    inst.file_drop(2, &std::mem::take(&mut self.dragging));
                } else if self.skip_drops > 0 {
                    self.skip_drops -= 1;
                } else {
                    inst.file_drop(2, &[p.to_string_lossy().into_owned()]);
                }
            }
            WindowEvent::CursorLeft { .. } => {
                inst.pointer(3, 0.0, 0.0);
                self.sync_cursor();
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let (x, y) = inst.pointer_position();
                if button == MouseButton::Left {
                    self.redraw_if(inst.pointer(if state == ElementState::Pressed { 0 } else { 1 }, x, y));
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
                self.redraw_if(inst.key(key_code(&event.logical_key), text, down, event.repeat, self.modifiers));
            }
            WindowEvent::Ime(ime) => {
                let changed = match ime {
                    Ime::Preedit(text, cursor) => inst.ime_preedit(&text, cursor),
                    Ime::Commit(text) => inst.ime_preedit("", None) | inst.insert_text(&text),
                    Ime::Disabled => inst.ime_preedit("", None),
                    Ime::Enabled => false,
                };
                self.redraw_if(changed);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let (dx, dy) = match delta {
                    MouseScrollDelta::LineDelta(x, y) => (-x * LINE, -y * LINE),
                    MouseScrollDelta::PixelDelta(p) => {
                        let s = self.scale() as f64;
                        ((-p.x / s) as f32, (-p.y / s) as f32)
                    }
                };
                let (x, y) = inst.pointer_position();
                self.redraw_if(inst.wheel(x, y, dx, dy));
            }
            WindowEvent::Focused(f) => {
                self.focused = f;
                self.sync_secure_keys();
            }
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::Occluded(false) => self.redraw_if(true),
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
