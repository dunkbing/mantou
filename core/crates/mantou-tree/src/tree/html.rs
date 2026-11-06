//! Html nodes (dunkbing/mantou#74): a static HTML/CSS document (mantou-html, with the `html` feature),
//! measured like text (its height follows the width it gets) and drawn as image bands: only the bands
//! that show are painted, on the CPU, and kept while they show and nothing changed. The selection isn't
//! painted in them: it's drawn over them, so dragging it repaints nothing.
//! Without the feature an Html node lays out empty and draws nothing.

use super::Tree;
#[cfg(feature = "html")]
use super::TreeEvent;

/// Logical px per band.
#[cfg(feature = "html")]
const BAND: f32 = 512.0;

#[derive(Default)]
pub(super) struct HtmlNode {
    #[cfg(feature = "html")]
    doc: std::cell::RefCell<Option<mantou_html::HtmlDoc>>,
    /// Painted bands by index: (the document's version, device px wide, pixels).
    #[cfg(feature = "html")]
    bands: std::cell::RefCell<std::collections::HashMap<u32, (u64, u32, std::sync::Arc<mantou_image::Pixels>)>>,
}

/// Runs `f` on a document, and drops the document if the HTML engine panics on it (some input it can't take):
/// the node then shows nothing, and the app goes on (dunkbing/mantou#87). The panic is logged by the hook.
#[cfg(feature = "html")]
fn guarded<R>(doc: &mut Option<mantou_html::HtmlDoc>, f: impl FnOnce(&mut mantou_html::HtmlDoc) -> R) -> Option<R> {
    let d = doc.as_mut()?;
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(d))) {
        Ok(r) => Some(r),
        Err(_) => {
            *doc = None;
            None
        }
    }
}

impl HtmlNode {
    /// The size it takes `width` wide (`None`: as wide as it likes) at `scale`, logical px.
    pub(super) fn measure(&self, width: Option<f32>, scale: f32) -> (f32, f32) {
        #[cfg(feature = "html")]
        {
            let w = width.unwrap_or(600.0);
            if let Some(h) = guarded(&mut self.doc.borrow_mut(), |doc| doc.layout(w, scale).1) {
                return (w, h);
            }
        }
        let _ = scale;
        (width.unwrap_or(0.0), 0.0)
    }

    /// The bands of a box whose content is `content` (logical, window coordinates, `k` times the document's px)
    /// and that shows within `visible`: (its rectangle in logical window coordinates, pixels), painted now
    /// if they changed. Bands that no longer show are dropped.
    #[cfg(feature = "html")]
    pub(super) fn bands(&self, content: [f32; 4], visible: [f32; 4], k: f32, scale: f32) -> Vec<([f32; 4], std::sync::Arc<mantou_image::Pixels>)> {
        let mut slot = self.doc.borrow_mut();
        let mut bands = self.bands.borrow_mut();
        let out = guarded(&mut slot, |doc| Self::paint_bands(doc, &mut bands, content, visible, k, scale)).unwrap_or_default();
        if slot.is_none() {
            bands.clear();
        }
        out
    }

    #[cfg(feature = "html")]
    fn paint_bands(
        doc: &mut mantou_html::HtmlDoc,
        bands: &mut std::collections::HashMap<u32, (u64, u32, std::sync::Arc<mantou_image::Pixels>)>,
        content: [f32; 4],
        visible: [f32; 4],
        k: f32,
        scale: f32,
    ) -> Vec<([f32; 4], std::sync::Arc<mantou_image::Pixels>)> {
        let mut out = Vec::new();
        let k = k.max(1e-3);
        let width = (content[2] - content[0]) / k;
        // Textures are at most 8192 px on a side: a very wide document is drawn at a lower scale.
        let px_scale = (scale * k).min(8192.0 / width.max(1.0));
        let (_, height) = doc.layout(width, px_scale);
        let height = height.min((content[3] - content[1]) / k);
        let (y0, y1) = (((visible[1] - content[1]) / k).max(0.0), ((visible[3] - content[1]) / k).min(height));
        if y1 <= y0 || visible[2] <= visible[0] {
            bands.clear();
            return out;
        }
        let width_px = (width * px_scale).round() as u32;
        let (first, last) = ((y0 / BAND) as u32, ((y1 - 1e-3) / BAND).max(0.0) as u32);
        bands.retain(|&i, (version, w, _)| i >= first && i <= last && *version == doc.version && *w == width_px);
        for i in first..=last {
            let top = i as f32 * BAND;
            let h = BAND.min(height - top);
            if h <= 0.0 {
                break;
            }
            let pixels = match bands.get(&i) {
                Some((_, _, p)) => p.clone(),
                None => {
                    let (w, hp, rgba) = doc.paint(top, h, px_scale);
                    let p = mantou_image::Pixels::new(w, hp, rgba);
                    bands.insert(i, (doc.version, width_px, p.clone()));
                    p
                }
            };
            out.push(([content[0], content[1] + top * k, content[2], content[1] + (top + h) * k], pixels));
        }
        out
    }

    /// The selection's highlight in a box whose content is `content` (logical, window coordinates, `k` times
    /// the document's px): rectangles in logical window coordinates, drawn over the bands.
    #[cfg(feature = "html")]
    pub(super) fn selection(&self, content: [f32; 4], k: f32) -> Vec<[f32; 4]> {
        let k = k.max(1e-3);
        let doc = self.doc.borrow();
        let Some(doc) = doc.as_ref() else { return Vec::new() };
        doc.selection_rects().into_iter().map(|r| [content[0] + r[0] * k, content[1] + r[1] * k, content[0] + r[2] * k, content[1] + r[3] * k]).collect()
    }

    /// Starts a selection at (x, y) (the document's px); whether there's text there.
    fn select_start(&self, x: f32, y: f32) -> bool {
        #[cfg(feature = "html")]
        return self.doc.borrow_mut().as_mut().is_some_and(|d| d.select_start(x, y));
        #[cfg(not(feature = "html"))]
        {
            let _ = (x, y);
            false
        }
    }

    /// Moves the selection's end to (x, y); whether it changed.
    fn select_to(&self, x: f32, y: f32) -> bool {
        #[cfg(feature = "html")]
        return self.doc.borrow_mut().as_mut().is_some_and(|d| d.select_to(x, y));
        #[cfg(not(feature = "html"))]
        {
            let _ = (x, y);
            false
        }
    }

    /// Drops the selection; whether there was one.
    fn select_none(&self) -> bool {
        #[cfg(feature = "html")]
        return self.doc.borrow_mut().as_mut().is_some_and(|d| d.select_none());
        #[cfg(not(feature = "html"))]
        false
    }

    fn selected_text(&self) -> Option<String> {
        #[cfg(feature = "html")]
        return self.doc.borrow().as_ref()?.selected_text();
        #[cfg(not(feature = "html"))]
        None
    }

    fn text_at(&self, x: f32, y: f32) -> bool {
        #[cfg(feature = "html")]
        return self.doc.borrow().as_ref().is_some_and(|d| d.text_at(x, y));
        #[cfg(not(feature = "html"))]
        {
            let _ = (x, y);
            false
        }
    }

    /// The link at (x, y), logical px from the content box's top left at `k`.
    pub(super) fn link_at(&self, x: f32, y: f32, k: f32) -> Option<String> {
        #[cfg(feature = "html")]
        return self.doc.borrow().as_ref()?.link_at(x / k.max(1e-3), y / k.max(1e-3));
        #[cfg(not(feature = "html"))]
        {
            let _ = (x, y, k);
            None
        }
    }
}

impl Tree {
    /// HTML: a new document for an Html node.
    pub(super) fn set_html(&mut self, id: u32, flags: u32, html: &str) -> Result<(), String> {
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let Some(h) = node.html.as_mut() else { return Err(format!("{id} is not an Html node")) };
        #[cfg(feature = "html")]
        {
            let dark = flags & crate::protocol::html_flag::DARK != 0;
            *h.doc.get_mut() = std::panic::catch_unwind(|| mantou_html::HtmlDoc::new(html, dark)).ok();
            h.bands.get_mut().clear();
        }
        #[cfg(not(feature = "html"))]
        let _ = (h, flags, html);
        let _ = self.taffy.mark_dirty(node.taffy);
        self.html_nodes.insert(id);
        self.layout_dirty = true;
        self.scene_dirty = true;
        Ok(())
    }

    /// HTML_RESOURCE: the app's answer for a URL an Html node's document asked for.
    pub(super) fn html_resource(&mut self, id: u32, url: &str, data: Option<Vec<u8>>) -> Result<(), String> {
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let Some(h) = node.html.as_mut() else { return Err(format!("{id} is not an Html node")) };
        #[cfg(feature = "html")]
        let took = guarded(h.doc.get_mut(), |d| d.provide(url, data)).unwrap_or(false);
        #[cfg(not(feature = "html"))]
        let took = {
            let _ = (h, url, data);
            false
        };
        if took {
            // An image's size can change the document's height.
            let _ = self.taffy.mark_dirty(node.taffy);
            self.layout_dirty = true;
            self.scene_dirty = true;
        }
        Ok(())
    }

    /// After a layout: what the documents asked for, as HTML_REQUEST events.
    pub(super) fn html_requests(&mut self) {
        #[cfg(feature = "html")]
        for &id in &self.html_nodes {
            let Some(h) = self.nodes.get(&id).and_then(|n| n.html.as_ref()) else { continue };
            let urls = h.doc.borrow().as_ref().map(|d| d.requests()).unwrap_or_default();
            for url in urls {
                self.events.push(TreeEvent::HtmlRequest { id, url });
            }
        }
    }

    /// (x, y) in the window's logical px, as Html node `id`'s document px (outside its box too), and the node.
    fn html_at(&self, id: u32, x: f32, y: f32) -> Option<(&HtmlNode, f32, f32)> {
        let b = self.boxes.iter().find(|b| b.id == id)?;
        let k = b.k.max(1e-3);
        Some((self.nodes.get(&id)?.html.as_deref()?, (x - b.content[0]) / k, (y - b.content[1]) / k))
    }

    /// A press on Html node `id` at (x, y): any other selection goes, and one starts here when there's text.
    /// Returns whether the scene changed.
    pub(super) fn html_press(&mut self, id: u32, x: f32, y: f32) -> bool {
        let mut changed = self.html_unselect(Some(id));
        if let Some((h, px, py)) = self.html_at(id, x, y) {
            changed |= h.select_none();
            if h.select_start(px, py) {
                self.html_sel = Some(id);
                self.drag = Some(id);
            }
        }
        if changed {
            self.scene_dirty = true;
        }
        changed
    }

    /// The pointer moved to (x, y) while selecting in Html node `id`; whether the selection changed.
    pub(super) fn html_drag(&mut self, id: u32, x: f32, y: f32) -> bool {
        let changed = self.html_at(id, x, y).is_some_and(|(h, px, py)| h.select_to(px, py));
        if changed {
            self.scene_dirty = true;
        }
        changed
    }

    /// Drops the Html selection, unless it's in `keep`; whether one went.
    pub(super) fn html_unselect(&mut self, keep: Option<u32>) -> bool {
        let Some(id) = self.html_sel.filter(|&i| Some(i) != keep) else { return false };
        self.html_sel = None;
        let gone = self.nodes.get(&id).and_then(|n| n.html.as_ref()).is_some_and(|h| h.select_none());
        if gone {
            self.scene_dirty = true;
        }
        gone
    }

    /// The text selected in an Html node's document, if any.
    pub(super) fn html_selected_text(&self) -> Option<String> {
        self.nodes.get(&self.html_sel?)?.html.as_ref()?.selected_text()
    }

    /// Whether there's text in Html node `id`'s document at (x, y) (the window's logical px).
    pub(super) fn html_text_at(&self, id: u32, x: f32, y: f32) -> bool {
        self.html_at(id, x, y).is_some_and(|(h, px, py)| h.text_at(px, py))
    }

    /// The `href` of the link at (x, y) (logical px, the window's) in Html node `id`, if any.
    pub fn html_link_at(&self, id: u32, x: f32, y: f32) -> Option<String> {
        let b = self.boxes.iter().find(|b| b.id == id)?;
        let c = b.content;
        if x < c[0] || x >= c[2] || y < c[1] || y >= c[3] {
            return None;
        }
        self.nodes.get(&id)?.html.as_ref()?.link_at(x - c[0], y - c[1], b.k)
    }
}
