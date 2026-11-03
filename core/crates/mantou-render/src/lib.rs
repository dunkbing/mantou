//! Draws a [`Scene`] with wgpu (design §9.3). For now it draws solid rectangles as
//! instanced quads in one pass; rounded corners, borders, shadows, clips and
//! glyphs come next, on the same instanced-quad design.

use mantou_tree::Scene;

/// Bytes per instance: rect (4 × f32) + colour (4 × f32).
const INSTANCE_BYTES: u64 = 32;

pub struct Renderer {
    pipeline: wgpu::RenderPipeline,
    instances: wgpu::Buffer,
    capacity: u64,
    /// The target stores sRGB-encoded values: colours are converted to linear.
    srgb_target: bool,
    scratch: Vec<f32>,
}

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

impl Renderer {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Renderer {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mantou rect"),
            source: wgpu::ShaderSource::Wgsl(include_str!("rect.wgsl").into()),
        });
        let attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("mantou rect"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: INSTANCE_BYTES,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &attributes,
                })],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let capacity = 256;
        Renderer {
            pipeline,
            instances: Self::buffer(device, capacity),
            capacity,
            srgb_target: format.is_srgb(),
            scratch: Vec::new(),
        }
    }

    fn buffer(device: &wgpu::Device, capacity: u64) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mantou rect instances"),
            size: capacity * INSTANCE_BYTES,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn color(&self, c: [f32; 4]) -> [f32; 4] {
        if self.srgb_target { [srgb_to_linear(c[0]), srgb_to_linear(c[1]), srgb_to_linear(c[2]), c[3]] } else { c }
    }

    /// Encodes one pass that clears `view` and draws the scene's rectangles.
    pub fn draw(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, view: &wgpu::TextureView, size_px: (u32, u32), scene: &Scene) -> wgpu::CommandBuffer {
        let (w, h) = (size_px.0.max(1) as f32, size_px.1.max(1) as f32);
        self.scratch.clear();
        for q in &scene.quads {
            let [x0, y0, x1, y1] = q.rect;
            let c = self.color(q.color);
            self.scratch.extend_from_slice(&[x0 / w * 2.0 - 1.0, 1.0 - y0 / h * 2.0, x1 / w * 2.0 - 1.0, 1.0 - y1 / h * 2.0]);
            self.scratch.extend_from_slice(&c);
        }
        let count = scene.quads.len() as u64;
        if count > self.capacity {
            self.capacity = count.next_power_of_two();
            self.instances = Self::buffer(device, self.capacity);
        }
        if count > 0 {
            let bytes: Vec<u8> = self.scratch.iter().flat_map(|f| f.to_le_bytes()).collect();
            queue.write_buffer(&self.instances, 0, &bytes);
        }
        let clear = self.color(scene.clear);
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("mantou frame") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("mantou frame"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: clear[0] as f64, g: clear[1] as f64, b: clear[2] as f64, a: clear[3] as f64 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            if count > 0 {
                pass.set_pipeline(&self.pipeline);
                pass.set_vertex_buffer(0, self.instances.slice(..count * INSTANCE_BYTES));
                pass.draw(0..6, 0..count as u32);
            }
        }
        encoder.finish()
    }
}

/// Renders scenes without a window, for headless tests (design §12.2):
/// into an RGBA8 sRGB texture, read back to memory.
pub struct Offscreen {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    info: String,
}

const OFFSCREEN_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

impl Offscreen {
    /// Opens any adapter (a software one such as lavapipe or WARP is fine).
    pub fn new() -> Result<Offscreen, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
            .map_err(|e| format!("no GPU adapter for offscreen rendering: {e}"))?;
        let i = adapter.get_info();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("mantou offscreen"),
            required_limits: wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| format!("cannot open the GPU device: {e}"))?;
        let renderer = Renderer::new(&device, OFFSCREEN_FORMAT);
        Ok(Offscreen { device, queue, renderer, info: format!("{} ({:?}, {:?})", i.name, i.backend, i.device_type) })
    }

    pub fn info(&self) -> &str {
        &self.info
    }

    /// Draws the scene at its size and returns its pixels: RGBA8, sRGB, rows top to bottom.
    pub fn capture(&mut self, scene: &Scene) -> Vec<u8> {
        let (w, h) = (scene.size_px.0.max(1), scene.size_px.1.max(1));
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("mantou capture"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: OFFSCREEN_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let draw = self.renderer.draw(&self.device, &self.queue, &view, (w, h), scene);
        let row = w * 4;
        let padded = row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mantou capture readback"),
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("mantou capture copy") });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit([draw, encoder.finish()]);
        buffer.map_async(wgpu::MapMode::Read, .., |_| {});
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let Ok(mapped) = buffer.get_mapped_range(..) else {
            return vec![0; (row * h) as usize];
        };
        let mut out = Vec::with_capacity((row * h) as usize);
        for y in 0..h as usize {
            let start = y * padded as usize;
            out.extend_from_slice(&mapped[start..start + row as usize]);
        }
        drop(mapped);
        buffer.unmap();
        out
    }
}
