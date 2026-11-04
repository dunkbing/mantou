//! Image nodes (design §9): a decoded source shared by every node that uses
//! the same file or bytes, its natural size for layout, and where its pixels
//! go in the box (objectFit). SVGs are rasterized at the size drawn; raster
//! images are drawn from their decoded pixels, scaled by the renderer.

use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Weak};

use mantou_image::{Image, Pixels};

use super::{Tree, TreeEvent};
use crate::protocol::object_fit;

#[derive(Default)]
pub(super) struct ImageNode {
    pub(super) source: Option<Arc<Image>>,
    /// An SVG's last rasterization, reused while the drawn size is the same.
    pub(super) drawn: RefCell<Option<Arc<Pixels>>>,
}

/// Where an image goes in a content box `c` (logical px): the rectangle it
/// covers there, and the part of the image (0–1 on each axis) shown in it.
pub(super) fn place(fit: u32, c: [f32; 4], natural: (f32, f32)) -> ([f32; 4], [f32; 4]) {
    let (bw, bh) = (c[2] - c[0], c[3] - c[1]);
    let (nw, nh) = (natural.0.max(1e-3), natural.1.max(1e-3));
    match fit {
        object_fit::CONTAIN => {
            let k = (bw / nw).min(bh / nh);
            let (w, h) = (nw * k, nh * k);
            let (x, y) = (c[0] + (bw - w) / 2.0, c[1] + (bh - h) / 2.0);
            ([x, y, x + w, y + h], [0.0, 0.0, 1.0, 1.0])
        }
        object_fit::COVER => {
            let k = (bw / nw).max(bh / nh);
            let (fx, fy) = ((bw / (nw * k)).min(1.0), (bh / (nh * k)).min(1.0));
            (c, [0.5 - fx / 2.0, 0.5 - fy / 2.0, 0.5 + fx / 2.0, 0.5 + fy / 2.0])
        }
        _ => (c, [0.0, 0.0, 1.0, 1.0]),
    }
}

/// The size an image node takes when its style doesn't set one: its natural
/// size, keeping the aspect ratio when only one side is known.
pub(super) fn measure(natural: Option<(f32, f32)>, known: (Option<f32>, Option<f32>)) -> (f32, f32) {
    let Some((nw, nh)) = natural.filter(|(w, h)| *w > 0.0 && *h > 0.0) else { return (known.0.unwrap_or(0.0), known.1.unwrap_or(0.0)) };
    match known {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, w * nh / nw),
        (None, Some(h)) => (h * nw / nh, h),
        (None, None) => (nw, nh),
    }
}

impl Tree {
    /// Sets an image node's source from a file or bytes, decoding it once per
    /// distinct source; queues IMAGE_LOAD or IMAGE_ERROR.
    pub(super) fn set_image(&mut self, id: u32, key: String, load: impl FnOnce() -> Result<Vec<u8>, String>) -> Result<(), String> {
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let Some(img) = node.image.as_mut() else { return Err(format!("{id} is not an image")) };
        let cached = self.image_cache.get(&key).and_then(Weak::upgrade);
        let decoded = match cached {
            Some(i) => Ok(i),
            None => load().and_then(|b| Image::decode(&b)).map(Arc::new),
        };
        match decoded {
            Ok(image) => {
                self.image_cache.insert(key, Arc::downgrade(&image));
                let (w, h) = image.natural_size();
                img.source = Some(image);
                self.events.push(TreeEvent::ImageLoad { id, size: [w, h] });
            }
            Err(message) => {
                img.source = None;
                self.events.push(TreeEvent::ImageError { id, message });
            }
        }
        *img.drawn.get_mut() = None;
        let _ = self.taffy.mark_dirty(node.taffy);
        self.layout_dirty = true;
        self.image_cache.retain(|_, w| w.strong_count() > 0);
        Ok(())
    }
}

/// The cache key of image bytes.
pub(super) fn bytes_key(data: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    data.hash(&mut h);
    format!("data:{:016x}:{}", h.finish(), data.len())
}
