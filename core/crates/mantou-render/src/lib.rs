//! Draws a [`Scene`] with wgpu (DESIGN.md §9.3). M1 draws solid rectangles as
//! instanced quads in one pass; rounded corners, borders, shadows, clips and
//! glyphs arrive in M2–M3 on the same instanced-quad design.

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
