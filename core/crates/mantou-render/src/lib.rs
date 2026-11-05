//! Draws a [`Scene`] with wgpu (design §9.3): every quad (filled rectangles,
//! shadows, glyphs, images) is one instance of one pipeline, drawn in paint
//! order in a single pass. Glyph coverage comes from the scene's atlas,
//! uploaded to a texture whenever its version changes. Each image has its own
//! texture; quads are drawn in runs that share one, still in paint order.

use std::collections::HashMap;
use std::sync::Arc;

use mantou_tree::{Pixels, Scene};
use mantou_text::AtlasImage;

/// Bytes per instance: rect (NDC), colour, uv, clip, rect (px), border colour, params, corner radii, border widths,
/// gradient end colour, gradient (angle, 1 = on) (11 × vec4<f32>).
const INSTANCE_BYTES: u64 = 208;

pub struct Renderer {
    pipeline: wgpu::RenderPipeline,
    instances: wgpu::Buffer,
    capacity: u64,
    /// The target stores sRGB-encoded values: colours are converted to linear.
    srgb_target: bool,
    scratch: Vec<f32>,
    atlas: wgpu::Texture,
    atlas_view: wgpu::TextureView,
    /// Size and version of the atlas the texture holds.
    atlas_state: (u32, u32, u64),
    sampler: wgpu::Sampler,
    /// Image textures by pixels id (0 = a 1×1 stand-in for quads without an image).
    images: HashMap<u32, wgpu::TextureView>,
    /// A bind group per image texture, with the current atlas; rebuilt when the atlas changes.
    binds: HashMap<u32, wgpu::BindGroup>,
}

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

impl Renderer {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Renderer {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mantou quads"),
            source: wgpu::ShaderSource::Wgsl(include_str!("rect.wgsl").into()),
        });
        let attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4, 8 => Float32x4, 9 => Float32x4, 10 => Float32x4, 11 => Float32x4, 12 => Float32x4];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("mantou quads"),
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
        let atlas = Self::atlas_texture(device, 1, 1);
        let atlas_view = atlas.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("mantou images"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let mut r = Renderer {
            pipeline,
            instances: Self::buffer(device, capacity),
            capacity,
            srgb_target: format.is_srgb(),
            scratch: Vec::new(),
            atlas,
            atlas_view,
            atlas_state: (1, 1, 0),
            sampler,
            images: HashMap::new(),
            binds: HashMap::new(),
        };
        let blank = r.image_texture(device, None, 1, 1);
        r.images.insert(0, blank);
        r
    }

    /// An RGBA texture for an image (straight alpha; sRGB-encoded when the target is).
    fn image_texture(&self, device: &wgpu::Device, queue: Option<(&wgpu::Queue, &Pixels)>, w: u32, h: u32) -> wgpu::TextureView {
        let format = if self.srgb_target { wgpu::TextureFormat::Rgba8UnormSrgb } else { wgpu::TextureFormat::Rgba8Unorm };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("mantou image"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        if let Some((queue, px)) = queue {
            queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                &px.rgba,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(h) },
                wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
        }
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }

    /// Uploads the scene's images the renderer doesn't have yet, and drops those it no longer uses.
    fn sync_images(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, scene: &Scene) {
        for (id, px) in &scene.images {
            if !self.images.contains_key(id) {
                let view = self.image_texture(device, Some((queue, px)), px.width, px.height);
                self.images.insert(*id, view);
            }
        }
        self.images.retain(|id, _| *id == 0 || scene.images.contains_key(id));
        self.binds.retain(|id, _| *id == 0 || scene.images.contains_key(id));
    }

    fn bind(&mut self, device: &wgpu::Device, image: u32) -> &wgpu::BindGroup {
        if !self.binds.contains_key(&image) {
            let view = self.images.get(&image).unwrap_or(&self.images[&0]);
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("mantou textures"),
                layout: &self.pipeline.get_bind_group_layout(0),
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&self.atlas_view) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                ],
            });
            self.binds.insert(image, group);
        }
        &self.binds[&image]
    }

    fn buffer(device: &wgpu::Device, capacity: u64) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mantou quad instances"),
            size: capacity * INSTANCE_BYTES,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn atlas_texture(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("mantou glyph atlas"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    /// Uploads the scene's atlas if the texture doesn't hold that version yet.
    fn sync_atlas(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, atlas: &Arc<AtlasImage>) {
        let (w, h, version) = self.atlas_state;
        if version == atlas.version && w == atlas.width && h == atlas.height {
            return;
        }
        if w != atlas.width || h != atlas.height {
            self.atlas = Self::atlas_texture(device, atlas.width, atlas.height);
            self.atlas_view = self.atlas.create_view(&wgpu::TextureViewDescriptor::default());
            self.binds.clear(); // they hold the old atlas
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &self.atlas, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &atlas.pixels,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(atlas.width), rows_per_image: Some(atlas.height) },
            wgpu::Extent3d { width: atlas.width, height: atlas.height, depth_or_array_layers: 1 },
        );
        self.atlas_state = (atlas.width, atlas.height, atlas.version);
    }

    fn color(&self, c: [f32; 4]) -> [f32; 4] {
        if self.srgb_target { [srgb_to_linear(c[0]), srgb_to_linear(c[1]), srgb_to_linear(c[2]), c[3]] } else { c }
    }

    /// Encodes one pass that clears `view` and draws the scene's quads.
    pub fn draw(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, view: &wgpu::TextureView, size_px: (u32, u32), scene: &Scene) -> wgpu::CommandBuffer {
        if let Some(atlas) = &scene.atlas {
            self.sync_atlas(device, queue, atlas);
        }
        self.sync_images(device, queue, scene);
        let (w, h) = (size_px.0.max(1) as f32, size_px.1.max(1) as f32);
        self.scratch.clear();
        for q in &scene.quads {
            // A shadow is drawn as far as its blur reaches (three sigmas), past its shape.
            let grow = if q.extra.trap.is_some() || q.extra.span.is_some() { 1.0 } else { q.shadow.map_or(0.0, |sigma| (3.0 * sigma).ceil() + 1.0) };
            let [mut x0, mut y0, mut x1, mut y1] = [q.rect[0] - grow, q.rect[1] - grow, q.rect[2] + grow, q.rect[3] + grow];
            if q.extra.rotation != 0.0 {
                // The corners of the turned rectangle: the quad covers their bounding box, and the shader turns back.
                let (cx, cy, hx, hy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (x1 - x0) / 2.0, (y1 - y0) / 2.0);
                let (sn, cs) = q.extra.rotation.sin_cos();
                let (ex, ey) = (hx * cs.abs() + hy * sn.abs() + 1.0, hx * sn.abs() + hy * cs.abs() + 1.0);
                (x0, y0, x1, y1) = (cx - ex, cy - ey, cx + ex, cy + ey);
            }
            let c = self.color(q.color);
            self.scratch.extend_from_slice(&[x0 / w * 2.0 - 1.0, 1.0 - y0 / h * 2.0, x1 / w * 2.0 - 1.0, 1.0 - y1 / h * 2.0]);
            self.scratch.extend_from_slice(&c);
            self.scratch.extend_from_slice(&q.uv);
            self.scratch.extend_from_slice(&q.clip);
            self.scratch.extend_from_slice(&q.rect);
            let bc = self.color(q.border_color);
            self.scratch.extend_from_slice(&bc);
            // params.w: 1 = a shadow (z = its sigma), 2 = an image (z = 1 to tint it).
            let params = match (q.shadow, q.image) {
                _ if q.extra.span.is_some() => [0.0, 0.0, 0.0, 4.0],
                _ if q.extra.trap.is_some() => [0.0, 0.0, 0.0, 3.0],
                (Some(sigma), _) => [q.radius, q.border, sigma, 1.0],
                (None, Some(img)) => [q.radius, 0.0, if img.tint { 1.0 } else { 0.0 }, 2.0],
                _ => [q.radius, q.border, 0.0, 0.0],
            };
            self.scratch.extend_from_slice(&params);
            // Corners and sides of their own (each falls back to the quad's radius and border), and the gradient.
            let radii = match q.extra.trap {
                _ if q.extra.span.is_some() => q.extra.span.unwrap(), // a row carries its edges' x here
                Some([yl, yr, yb]) => [yl, yr, yb, 0.0], // a strip carries its edges' heights here
                None => q.extra.radii.map(|r| if r >= 0.0 { r } else { q.radius }),
            };
            let widths = q.extra.widths.map(|w| if w >= 0.0 { w } else { q.border });
            self.scratch.extend_from_slice(&radii);
            self.scratch.extend_from_slice(&widths);
            let (end, angle, on) = q.extra.gradient.map_or(([0.0; 4], 0.0, 0.0), |g| (self.color(g.end), g.angle, 1.0));
            self.scratch.extend_from_slice(&end);
            self.scratch.extend_from_slice(&[angle, on, q.extra.rotation, 0.0]);
            // The middle stop's colour; then (its position + 1, or 0 for none; 1 = radial).
            let (mid, at, radial) = match q.extra.gradient {
                Some(g) => (g.mid.map_or([0.0; 4], |m| self.color(m.0)), g.mid.map_or(0.0, |m| m.1 + 1.0), if g.radial { 1.0 } else { 0.0 }),
                None => ([0.0; 4], 0.0, 0.0),
            };
            self.scratch.extend_from_slice(&mid);
            self.scratch.extend_from_slice(&[at, radial, 0.0, 0.0]);
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
        let mut binds: HashMap<u32, wgpu::BindGroup> = HashMap::new();
        for q in &scene.quads {
            let k = q.image.map_or(0, |r| r.id);
            if !binds.contains_key(&k) {
                let group = self.bind(device, k).clone();
                binds.insert(k, group);
            }
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
                // Runs of quads that share a texture, in paint order.
                let key = |i: usize| scene.quads[i].image.map_or(0, |r| r.id);
                let mut start = 0;
                while start < scene.quads.len() {
                    let k = key(start);
                    let mut end = start + 1;
                    while end < scene.quads.len() && key(end) == k {
                        end += 1;
                    }
                    pass.set_bind_group(0, &binds[&k], &[]);
                    pass.draw(0..6, start as u32..end as u32);
                    start = end;
                }
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
    /// Vulkan, Metal and D3D12 come first; OpenGL only when none of them has
    /// an adapter, because EGL without a display can stall for seconds on
    /// some machines (seen on GitHub's Linux runners). `WGPU_BACKEND` overrides.
    pub fn new() -> Result<Offscreen, String> {
        let explicit = std::env::var_os("WGPU_BACKEND").is_some();
        let order = if explicit {
            vec![wgpu::InstanceDescriptor::new_without_display_handle_from_env().backends]
        } else {
            vec![wgpu::Backends::PRIMARY, wgpu::Backends::SECONDARY]
        };
        let mut last = String::from("no backends to try");
        let mut found = None;
        for backends in order {
            let mut desc = wgpu::InstanceDescriptor::new_without_display_handle_from_env();
            desc.backends = backends;
            let instance = wgpu::Instance::new(desc);
            match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())) {
                Ok(a) => {
                    found = Some(a);
                    break;
                }
                Err(e) => last = e.to_string(),
            }
        }
        let adapter = found.ok_or_else(|| format!("no GPU adapter for offscreen rendering: {last}"))?;
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
