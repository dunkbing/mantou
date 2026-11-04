//! Images for `<Image>` nodes (design §9): raster images (PNG, JPEG, WebP)
//! decoded once, and SVGs parsed once and rasterized at the size they're
//! drawn at. Pixels are RGBA8 with straight alpha, top row first; the
//! renderer samples them, so a raster image is drawn at any size from its
//! decoded pixels.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// The longest side a raster image is kept at; bigger ones are scaled down when decoded.
pub const MAX_SIDE: u32 = 4096;

/// Pixels the renderer uploads as one texture. `id` is unique per set of pixels, so the renderer can cache textures by it.
#[derive(Debug, PartialEq)]
pub struct Pixels {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    /// RGBA8, straight alpha, top row first.
    pub rgba: Vec<u8>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

impl Pixels {
    fn new(width: u32, height: u32, rgba: Vec<u8>) -> Arc<Pixels> {
        Arc::new(Pixels { id: NEXT_ID.fetch_add(1, Ordering::Relaxed), width, height, rgba })
    }
}

/// A decoded image.
pub enum Image {
    Raster(Arc<Pixels>),
    Svg { tree: resvg::usvg::Tree },
}

impl std::fmt::Debug for Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Image::Raster(p) => write!(f, "Raster({}×{})", p.width, p.height),
            Image::Svg { tree } => write!(f, "Svg({:?})", tree.size()),
        }
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(1024)];
    let text = String::from_utf8_lossy(head);
    let t = text.trim_start_matches('\u{feff}').trim_start();
    t.starts_with('<') && (t.contains("<svg") || t.starts_with("<?xml"))
}

impl Image {
    /// Decodes PNG, JPEG, WebP or SVG bytes.
    pub fn decode(bytes: &[u8]) -> Result<Image, String> {
        if looks_like_svg(bytes) {
            let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).map_err(|e| format!("not a valid SVG: {e}"))?;
            return Ok(Image::Svg { tree });
        }
        let img = image::load_from_memory(bytes).map_err(|e| format!("can't decode the image: {e}"))?;
        let img = if img.width() > MAX_SIDE || img.height() > MAX_SIDE { img.thumbnail(MAX_SIDE, MAX_SIDE) } else { img };
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        Ok(Image::Raster(Pixels::new(w, h, rgba.into_raw())))
    }

    /// The natural size, in logical px (an image pixel is a logical px, as in CSS).
    pub fn natural_size(&self) -> (f32, f32) {
        match self {
            Image::Raster(p) => (p.width as f32, p.height as f32),
            Image::Svg { tree } => (tree.size().width(), tree.size().height()),
        }
    }

    pub fn is_svg(&self) -> bool {
        matches!(self, Image::Svg { .. })
    }

    /// Pixels to draw it at `width` × `height` device px: a raster image's own
    /// (the renderer scales them), or the SVG rasterized at that size.
    pub fn pixels(&self, width: u32, height: u32) -> Option<Arc<Pixels>> {
        match self {
            Image::Raster(p) => Some(p.clone()),
            Image::Svg { tree } => {
                let (w, h) = (width.clamp(1, MAX_SIDE), height.clamp(1, MAX_SIDE));
                let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)?;
                let size = tree.size();
                let t = resvg::tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height());
                resvg::render(tree, t, &mut pixmap.as_mut());
                // tiny-skia's pixels are premultiplied; the renderer wants straight alpha.
                let mut rgba = pixmap.take();
                for px in rgba.chunks_exact_mut(4) {
                    let a = px[3] as u32;
                    if a > 0 && a < 255 {
                        for c in &mut px[..3] {
                            *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                        }
                    }
                }
                Some(Pixels::new(w, h, rgba))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_fn(w, h, |x, y| image::Rgba([(x * 40) as u8, (y * 40) as u8, 200, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    const ICON: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="10" rx="2" fill="none" stroke="black" stroke-width="2"/></svg>"#;

    #[test]
    fn a_png_decodes_to_its_pixels_and_size() {
        let img = Image::decode(&png(5, 3)).unwrap();
        assert_eq!(img.natural_size(), (5.0, 3.0));
        let p = img.pixels(100, 100).unwrap();
        assert_eq!((p.width, p.height), (5, 3), "raster pixels are kept; the renderer scales them");
        assert_eq!(&p.rgba[4..8], &[40, 0, 200, 255]);
    }

    #[test]
    fn an_svg_has_its_declared_size_and_rasterizes_at_any_size() {
        let img = Image::decode(ICON.as_bytes()).unwrap();
        assert!(img.is_svg());
        assert_eq!(img.natural_size(), (16.0, 12.0));
        let p = img.pixels(32, 24).unwrap();
        assert_eq!((p.width, p.height), (32, 24));
        let alpha = |x: u32, y: u32| p.rgba[((y * 32 + x) * 4 + 3) as usize];
        assert_eq!(alpha(16, 12), 0, "the middle is empty");
        assert!(alpha(16, 3) > 200, "the stroke is drawn");
        assert_ne!(img.pixels(32, 24).unwrap().id, p.id, "each rasterization gets its own id");
    }

    #[test]
    fn bad_data_is_an_error() {
        assert!(Image::decode(b"not an image").is_err());
        assert!(Image::decode(b"<svg").is_err());
    }
}
