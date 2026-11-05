//! Static HTML/CSS documents (dunkbing/mantou#74), for HTML mail: parsed, styled and laid out by Blitz
//! (Stylo, Taffy, Parley), painted on the CPU (vello_cpu) a band at a time. No scripts run, and nothing is
//! fetched: every image or stylesheet the document asks for is queued for the app (`requests`), which
//! answers with its bytes or with nothing (`provide`). `data:` URLs are decoded here.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use anyrender::render_to_buffer;
use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::{DocumentConfig, Point, StyleThreading, local_name};
use blitz_html::HtmlDocument;
use blitz_traits::net::{Bytes, NetHandler, NetProvider, Request};
use blitz_traits::shell::{ColorScheme, Viewport};

/// The viewport height documents are laid out against (for `vh` units); their height is their content's.
const VIEWPORT_HEIGHT: f32 = 600.0;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Holds the document's requests until the app answers them.
#[derive(Default)]
struct Net {
    waiting: Mutex<HashMap<String, Vec<Box<dyn NetHandler>>>>,
    asked: Mutex<Vec<String>>,
}

impl NetProvider for Net {
    fn fetch(&self, _doc: usize, request: Request, handler: Box<dyn NetHandler>) {
        let url = request.url.to_string();
        if request.url.scheme() == "data" {
            let body = data_url::DataUrl::process(&url).ok().and_then(|d| d.decode_to_vec().ok()).map(|(b, _)| b).unwrap_or_default();
            return handler.bytes(url, Bytes::from(body));
        }
        let mut waiting = lock(&self.waiting);
        let first = !waiting.contains_key(&url);
        waiting.entry(url.clone()).or_default().push(handler);
        if first {
            lock(&self.asked).push(url);
        }
    }
}

/// One document.
pub struct HtmlDoc {
    doc: HtmlDocument,
    net: Arc<Net>,
    dark: bool,
    /// What it was last laid out for: (width in device px, scale bits).
    laid: Option<(u32, u32)>,
    /// Something changed since (a resource arrived): lay out again.
    stale: bool,
    width: f32,
    size: (f32, f32),
    /// Bumped whenever what it paints may have changed.
    pub version: u64,
}

// SAFETY: a document is only ever used by one thread at a time (the tree holding it is behind a mutex), and
// nothing in it is shared outside it: styles run sequentially on the calling thread (`StyleThreading::Sequential`).
unsafe impl Send for HtmlDoc {}

fn viewport(width: f32, scale: f32, dark: bool) -> Viewport {
    let px = |v: f32| (v * scale).round().max(1.0) as u32;
    Viewport::new(px(width), px(VIEWPORT_HEIGHT), scale, if dark { ColorScheme::Dark } else { ColorScheme::Light })
}

impl HtmlDoc {
    /// Parses `html`; `dark` answers `prefers-color-scheme`.
    pub fn new(html: &str, dark: bool) -> HtmlDoc {
        let net = Arc::new(Net::default());
        let doc = HtmlDocument::from_html(
            html,
            DocumentConfig {
                viewport: Some(viewport(600.0, 1.0, dark)),
                net_provider: Some(net.clone()),
                font_ctx: Some(mantou_text::font_context()),
                style_threading: StyleThreading::Sequential,
                ..Default::default()
            },
        );
        HtmlDoc { doc, net, dark, laid: None, stale: true, width: 600.0, size: (0.0, 0.0), version: 1 }
    }

    /// Lays it out `width` logical px wide at `scale` device px per px (only when either changed, or a
    /// resource arrived); its content's size, logical px.
    pub fn layout(&mut self, width: f32, scale: f32) -> (f32, f32) {
        let (width, scale) = (if width.is_finite() { width.max(1.0) } else { 600.0 }, if scale.is_finite() && scale > 0.0 { scale } else { 1.0 });
        let key = ((width * scale).round() as u32, scale.to_bits());
        if self.laid == Some(key) && !self.stale {
            return self.size;
        }
        if self.laid != Some(key) {
            self.doc.set_viewport(viewport(width, scale, self.dark));
        }
        self.doc.handle_messages();
        self.doc.resolve(0.0);
        let root = self.doc.root_element().final_layout();
        self.size = (root.size.width.max(width), root.size.height);
        self.width = width;
        self.laid = Some(key);
        self.stale = false;
        self.version += 1;
        self.size
    }

    /// The URLs it asked for since the last call, each once.
    pub fn requests(&self) -> Vec<String> {
        std::mem::take(&mut *lock(&self.net.asked))
    }

    /// The app's answer for `url`: its bytes, or None (blocked, or not found: an image shows nothing).
    /// Whether anything was waiting for it. It's laid out again on the next `layout`.
    pub fn provide(&mut self, url: &str, bytes: Option<Vec<u8>>) -> bool {
        let Some(handlers) = lock(&self.net.waiting).remove(url) else { return false };
        let body = Bytes::from(bytes.unwrap_or_default());
        for h in handlers {
            h.bytes(url.to_owned(), body.clone());
        }
        self.stale = true;
        true
    }

    /// Paints the band from `top` to `top + height` (logical px, the document's coordinates) at the last
    /// layout's width and `scale`: (width, height, RGBA8 with straight alpha).
    pub fn paint(&mut self, top: f32, height: f32, scale: f32) -> (u32, u32, Vec<u8>) {
        let (w, h) = ((self.width * scale).round().max(1.0) as u32, (height * scale).round().max(1.0) as u32);
        self.doc.set_viewport_scroll(Point { x: 0.0, y: top as f64 });
        let doc = &mut self.doc;
        let mut rgba = render_to_buffer::<VelloCpuImageRenderer, _>(|scene| blitz_paint::paint_scene(scene, doc, scale as f64, w, h, 0, 0), w, h);
        self.doc.set_viewport_scroll(Point { x: 0.0, y: 0.0 });
        // vello_cpu's pixels are premultiplied.
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a != 0 && a != 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        (w, h, rgba)
    }

    /// A press at (x, y) (logical px from its top left): a selection starts there, empty, when there's text
    /// there (whether it did); any earlier one is dropped.
    pub fn select_start(&mut self, x: f32, y: f32) -> bool {
        if self.doc.has_text_selection() {
            self.version += 1; // its highlight goes
        }
        match self.doc.find_text_position(x, y) {
            Some((node, offset)) => {
                self.doc.set_text_selection(node, offset, node, offset);
                true
            }
            None => {
                self.doc.clear_text_selection();
                false
            }
        }
    }

    /// The pointer moved to (x, y) while selecting: the selection's end goes there (when there's text there).
    /// Whether it changed.
    pub fn select_to(&mut self, x: f32, y: f32) -> bool {
        let before = self.doc.get_text_selection_ranges();
        if !self.doc.extend_text_selection_to_point(x, y) || self.doc.get_text_selection_ranges() == before {
            return false;
        }
        self.version += 1;
        true
    }

    /// Drops the selection; whether there was one.
    pub fn select_none(&mut self) -> bool {
        if !self.doc.has_text_selection() {
            return false;
        }
        self.doc.clear_text_selection();
        self.version += 1;
        true
    }

    /// The selected text, if any is selected (blocks joined by a space).
    pub fn selected_text(&self) -> Option<String> {
        self.doc.get_selected_text().filter(|s| !s.is_empty())
    }

    /// Whether there's text at (x, y): the pointer shows the text cursor there.
    pub fn text_at(&self, x: f32, y: f32) -> bool {
        self.doc.hit(x, y).is_some_and(|h| h.is_text)
    }

    /// The `href` of the link at (x, y), logical px from its top left, if there is one.
    pub fn link_at(&self, x: f32, y: f32) -> Option<String> {
        let hit = self.doc.hit(x, y)?;
        let mut at = Some(hit.node_id);
        while let Some(id) = at {
            let node = self.doc.get_node(id)?;
            if node.element_data().is_some_and(|e| e.name.local == local_name!("a"))
                && let Some(href) = node.attr(local_name!("href"))
            {
                return Some(href.to_owned());
            }
            at = node.parent;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIL: &str = r#"<html><body style="margin:0;background:#ffffff">
        <table width="300" cellpadding="0" cellspacing="0"><tr><td style="background:#1f883d;height:40px">
          <a href="https://example.com/go" style="display:block;height:40px;color:#ffffff">Go</a>
        </td></tr></table>
        <img src="cid:logo@mail" width="50" height="20" style="display:block">
        <div style="height:100px;background:#ff0000"></div>
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" width="1" height="1">
    </body></html>"#;

    #[test]
    fn its_height_is_its_content_and_follows_the_width() {
        let mut d = HtmlDoc::new(MAIL, false);
        let (w, h) = d.layout(400.0, 1.0);
        assert_eq!(w, 400.0);
        assert!((160.0..=190.0).contains(&h), "40 + 20 + 100, and a line for the 1 px inline image: {h}");
        let v = d.version;
        assert_eq!(d.layout(400.0, 1.0), (w, h));
        assert_eq!(d.version, v, "nothing changed: not laid out again");
        let text = "word ".repeat(200);
        let mut p = HtmlDoc::new(&format!("<p style='margin:0'>{text}</p>"), false);
        let (_, narrow) = p.layout(200.0, 1.0);
        let (_, wide) = p.layout(800.0, 1.0);
        assert!(narrow > wide * 3.0, "wrapping: {narrow} vs {wide}");
    }

    #[test]
    fn images_are_asked_for_once_and_data_urls_are_not() {
        let mut d = HtmlDoc::new(MAIL, false);
        d.layout(400.0, 1.0);
        assert_eq!(d.requests(), ["cid:logo@mail"]);
        assert!(d.requests().is_empty());
        assert!(d.provide("cid:logo@mail", None));
        assert!(!d.provide("cid:logo@mail", None), "answered already");
        assert!(!d.provide("https://never.example/x.png", Some(vec![1, 2, 3])));
    }

    #[test]
    fn a_band_paints_its_part() {
        let mut d = HtmlDoc::new(MAIL, false);
        d.layout(400.0, 2.0);
        let (w, h, px) = d.paint(0.0, 50.0, 2.0);
        assert_eq!((w, h), (800, 100));
        let at = |x: u32, y: u32| &px[((y * w + x) * 4) as usize..][..4];
        assert_eq!(at(10, 10), [0x1f, 0x88, 0x3d, 255], "the green cell");
        assert_eq!(at(700, 10), [255, 255, 255, 255], "the white body beside it");
        // The red block is 60 to 160 px down: a band from 80 starts inside it.
        let (_, _, px) = d.paint(80.0, 50.0, 2.0);
        assert_eq!(&px[..4], [255, 0, 0, 255]);
    }

    #[test]
    fn links_are_found_where_they_are_drawn() {
        let mut d = HtmlDoc::new(MAIL, false);
        d.layout(400.0, 1.0);
        assert_eq!(d.link_at(20.0, 20.0).as_deref(), Some("https://example.com/go"));
        assert_eq!(d.link_at(20.0, 120.0), None, "the red block");
        assert_eq!(d.link_at(350.0, 20.0), None, "beside the 300 px table");
    }

    #[test]
    fn a_drag_selects_text_and_the_selection_is_drawn() {
        let mut d = HtmlDoc::new("<body style='margin:0;font-size:20px;line-height:30px'><p style='margin:0'>Hello there</p><p style='margin:0'>General Kenobi</p></body>", false);
        d.layout(400.0, 1.0);
        let plain = d.paint(0.0, 60.0, 1.0).2;
        assert!(d.select_start(2.0, 15.0));
        assert_eq!(d.selected_text(), None, "a press selects nothing yet");
        assert!(d.select_to(60.0, 15.0));
        let first = d.selected_text().unwrap();
        assert!(first.starts_with("Hel") && "Hello there".starts_with(&first), "{first}");
        assert!(!d.select_to(60.0, 15.0), "the same point: no change");
        assert!(d.select_to(70.0, 45.0));
        let both = d.selected_text().unwrap();
        assert!(both.starts_with("Hello there") && both.contains("Gen"), "{both}");
        assert_ne!(d.paint(0.0, 60.0, 1.0).2, plain, "the highlight is drawn");
        assert!(d.select_none());
        assert_eq!(d.selected_text(), None);
        assert!(!d.select_none());
        assert_eq!(d.paint(0.0, 60.0, 1.0).2, plain);
        assert!(d.text_at(5.0, 15.0));
        assert!(!d.text_at(300.0, 15.0), "past the end of the line");
    }

    #[test]
    fn dark_mode_answers_prefers_color_scheme() {
        let html = "<style>body{margin:0;background:#fff} @media (prefers-color-scheme: dark){body{background:#000}}</style><div style='height:10px'></div>";
        for (dark, want) in [(false, 255), (true, 0)] {
            let mut d = HtmlDoc::new(html, dark);
            d.layout(100.0, 1.0);
            let (_, _, px) = d.paint(0.0, 10.0, 1.0);
            assert_eq!(px[0], want, "dark {dark}");
        }
    }
}

