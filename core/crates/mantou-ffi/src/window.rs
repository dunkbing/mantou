//! The window: winit on Bun's main thread, drawing the app instance's scene
//! with wgpu, laying out again on resize and turning input into events.

use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use mantou_render::Renderer;
use mantou_tree::Scene;
use mantou_tree::protocol::event as ev;
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalSize};
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

use crate::instance::{Instance, bump, lock};
use crate::{G, UserEvent, app};

/// Named keys travel above the Unicode range.
mod key {
    pub const ESCAPE: u32 = 0x11_0000;
    pub const ENTER: u32 = 0x11_0001;
    pub const OTHER: u32 = 0x11_FFFF;
}

pub struct Config {
    pub width: u32,
    pub height: u32,
    pub title: String,
}

impl Config {
    /// `[width, height, titleLen]` as u32 words, then the title's UTF-8 bytes.
    pub fn parse(b: &[u8]) -> Config {
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

pub struct App {
    config: Config,
    inst: Arc<Instance>,
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
}

impl App {
    pub fn new(config: Config) -> App {
        App { config, inst: app(), window: None, gpu: None }
    }

    fn draw(&mut self) {
        let Some(window) = self.window.clone() else { return };
        if let Some(t) = lock(&self.inst.tree).take_title() {
            window.set_title(&t);
        }
        let scene = lock(&self.inst.scene).clone();
        let Some(gpu) = self.gpu.as_mut() else { return };
        window.pre_present_notify();
        if gpu.draw(&scene) {
            bump(&self.inst.stats.frames);
        } else {
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
                eprintln!("mantou-core: GPU unavailable, nothing will be drawn: {e}");
                *lock(&G.info) = format!("no GPU ({e}); {}", std::env::consts::OS);
            }
        }
        let size = window.inner_size();
        let scale = window.scale_factor() as f32;
        self.window = Some(window.clone());
        self.inst.relayout(size.width, size.height, scale);
        self.inst.push_event([ev::WINDOW_READY, size.width, size.height, scale.to_bits()]);
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
            UserEvent::TestPointer(kind, x, y) => self.inst.pointer(kind, x, y),
        }
    }

    fn window_event(&mut self, _el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
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
                inst.push_event([ev::RESIZED, size.width, size.height, 0]);
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
                inst.pointer(2, position.x as f32 / s, position.y as f32 / s);
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let (x, y) = inst.pointer_position();
                if button == MouseButton::Left {
                    inst.pointer(if state == ElementState::Pressed { 0 } else { 1 }, x, y);
                } else {
                    let kind = if state == ElementState::Pressed { ev::POINTER_DOWN } else { ev::POINTER_UP };
                    inst.push_event([kind, button_code(button), x.to_bits(), y.to_bits()]);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let kind = if event.state == ElementState::Pressed { ev::KEY_DOWN } else { ev::KEY_UP };
                inst.push_event([kind, key_code(&event.logical_key), event.repeat as u32, 0]);
            }
            WindowEvent::RedrawRequested => self.draw(),
            _ => {}
        }
    }
}
