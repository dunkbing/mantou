//! Mantou's text (design §8.5): lays text out with parley, rasterizes glyphs
//! with swash into a coverage atlas, and ships the Inter font so text looks
//! the same on every platform. System fonts are the fallback for what Inter
//! lacks (emoji, other scripts). Layouts are cached by their text, style and
//! width. No platform or GPU dependencies.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use parley::fontique::Blob;
use parley::{
    Alignment, AlignmentOptions, FontContext, FontData, FontFamily, FontStyle, FontWeight, Layout, LayoutContext,
    LineHeight, PositionedLayoutItem, StyleProperty,
};
use swash::scale::{Render, ScaleContext, Source, StrikeWith, image::Content};
use swash::zeno::{Format, Vector};

const INTER: [&[u8]; 4] = [
    include_bytes!("../fonts/Inter-Regular.ttf"),
    include_bytes!("../fonts/Inter-Medium.ttf"),
    include_bytes!("../fonts/Inter-SemiBold.ttf"),
    include_bytes!("../fonts/Inter-Bold.ttf"),
];

/// The family stack every text uses: the bundled Inter, then the system's.
const FAMILY: &str = "Inter, system-ui, sans-serif";

/// Horizontal subpixel positions per pixel that glyphs are rasterized at.
const SUBPIXEL_BINS: f32 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

/// How a text node's text is set. Lengths are logical px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextStyle {
    pub size: f32,
    pub weight: f32,
    /// A multiple of the font size; 0 = the font's own line height.
    pub line_height: f32,
    pub align: Align,
    /// 0 = no limit. A cut-off last line ends in an ellipsis.
    pub max_lines: u32,
    pub italic: bool,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle { size: 14.0, weight: 400.0, line_height: 0.0, align: Align::Start, max_lines: 0, italic: false }
    }
}

impl TextStyle {
    fn key(&self) -> [u32; 6] {
        [
            self.size.to_bits(),
            self.weight.to_bits(),
            self.line_height.to_bits(),
            self.align as u32,
            self.max_lines,
            self.italic as u32,
        ]
    }
}

/// A glyph placed in a layout: logical px from the layout's top left, `y` on the baseline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlacedGlyph {
    pub font: u32,
    pub id: u32,
    pub size: f32,
    pub x: f32,
    pub y: f32,
    pub advance: f32,
}

/// Laid-out text. Immutable; shared between the tree and scenes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextLayout {
    pub width: f32,
    pub height: f32,
    pub lines: u32,
    /// Lines were cut off (`max_lines`) or a single line was too wide: it ends in an ellipsis.
    pub truncated: bool,
    pub glyphs: Vec<PlacedGlyph>,
}

/// A glyph's bitmap in the atlas, and where it sits relative to its pen position (device px).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AtlasEntry {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub left: i32,
    pub top: i32,
}

/// The coverage atlas (one byte per texel). Renderers upload it whenever `version` changes.
#[derive(Clone, Debug, PartialEq)]
pub struct AtlasImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub version: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct GlyphKey {
    font: u32,
    id: u32,
    size_bits: u32,
    bin: u8,
}

struct Shelf {
    y: u32,
    h: u32,
    x: u32,
}

const ATLAS_START: u32 = 512;
const ATLAS_MAX: u32 = 4096;
const PAD: u32 = 1;

struct Atlas {
    image: Arc<AtlasImage>,
    shelves: Vec<Shelf>,
    next_y: u32,
    entries: HashMap<GlyphKey, Option<AtlasEntry>>,
}

impl Atlas {
    fn new() -> Atlas {
        Atlas {
            image: Arc::new(AtlasImage { width: ATLAS_START, height: ATLAS_START, pixels: vec![0; (ATLAS_START * ATLAS_START) as usize], version: 1 }),
            shelves: Vec::new(),
            next_y: 0,
            entries: HashMap::new(),
        }
    }

    /// Finds room for a w × h bitmap, growing the atlas when it's full.
    fn alloc(&mut self, w: u32, h: u32) -> Option<(u32, u32)> {
        let (pw, ph) = (w + PAD, h + PAD);
        loop {
            let width = self.image.width;
            if let Some(s) = self.shelves.iter_mut().find(|s| s.h >= ph && s.h <= ph + ph / 4 + 2 && s.x + pw <= width) {
                let at = (s.x, s.y);
                s.x += pw;
                return Some(at);
            }
            if self.next_y + ph <= self.image.height && pw <= width {
                self.shelves.push(Shelf { y: self.next_y, h: ph, x: pw });
                let at = (0, self.next_y);
                self.next_y += ph;
                return Some(at);
            }
            if self.image.width >= ATLAS_MAX {
                return None;
            }
            self.grow();
        }
    }

    /// Doubles the atlas; existing glyphs keep their places.
    fn grow(&mut self) {
        let old = self.image.clone();
        let (w, h) = (old.width * 2, old.height * 2);
        let mut pixels = vec![0; (w * h) as usize];
        for y in 0..old.height as usize {
            let src = &old.pixels[y * old.width as usize..(y + 1) * old.width as usize];
            pixels[y * w as usize..y * w as usize + old.width as usize].copy_from_slice(src);
        }
        self.image = Arc::new(AtlasImage { width: w, height: h, pixels, version: old.version + 1 });
    }

    fn blit(&mut self, x: u32, y: u32, w: u32, h: u32, data: &[u8]) {
        let img = Arc::make_mut(&mut self.image);
        for row in 0..h as usize {
            let dst = (y as usize + row) * img.width as usize + x as usize;
            img.pixels[dst..dst + w as usize].copy_from_slice(&data[row * w as usize..(row + 1) * w as usize]);
        }
        img.version += 1;
    }
}

type LayoutKey = (String, [u32; 6], u32);

/// Text layout and glyph rasterization for one tree.
pub struct TextEngine {
    fcx: FontContext,
    lcx: LayoutContext<()>,
    scx: ScaleContext,
    font_ids: HashMap<(u64, u32), u32>,
    fonts: Vec<FontData>,
    atlas: Atlas,
    cache: HashMap<LayoutKey, Arc<TextLayout>>,
    ellipses: HashMap<[u32; 6], Vec<PlacedGlyph>>,
}

impl Default for TextEngine {
    fn default() -> Self {
        Self::new()
    }
}

const CACHE_LIMIT: usize = 4096;

/// Fonts are found and registered once per process; each engine gets a clone.
static FONTS: LazyLock<Mutex<FontContext>> = LazyLock::new(|| {
    let mut fcx = FontContext::new();
    for data in INTER {
        fcx.collection.register_fonts(Blob::new(Arc::new(data)), None);
    }
    Mutex::new(fcx)
});

impl TextEngine {
    pub fn new() -> TextEngine {
        let fcx = FONTS.lock().unwrap_or_else(|e| e.into_inner()).clone();
        TextEngine {
            fcx,
            lcx: LayoutContext::new(),
            scx: ScaleContext::new(),
            font_ids: HashMap::new(),
            fonts: Vec::new(),
            atlas: Atlas::new(),
            cache: HashMap::new(),
            ellipses: HashMap::new(),
        }
    }

    fn font_id(&mut self, font: &FontData) -> u32 {
        let key = (font.data.id(), font.index);
        if let Some(&id) = self.font_ids.get(&key) {
            return id;
        }
        let id = self.fonts.len() as u32;
        self.fonts.push(font.clone());
        self.font_ids.insert(key, id);
        id
    }

    fn shape(&mut self, text: &str, style: &TextStyle) -> Layout<()> {
        let mut b = self.lcx.ranged_builder(&mut self.fcx, text, 1.0, false);
        b.push_default(StyleProperty::FontFamily(FontFamily::Source(Cow::Borrowed(FAMILY))));
        b.push_default(StyleProperty::FontSize(style.size));
        b.push_default(StyleProperty::FontWeight(FontWeight::new(style.weight)));
        b.push_default(StyleProperty::FontStyle(if style.italic { FontStyle::Italic } else { FontStyle::Normal }));
        b.push_default(StyleProperty::LineHeight(if style.line_height > 0.0 {
            LineHeight::FontSizeRelative(style.line_height)
        } else {
            LineHeight::MetricsRelative(1.0)
        }));
        b.build(text)
    }

    /// Each kept line's glyphs, and its (baseline, line height, width without hanging whitespace).
    fn glyphs_of(&mut self, layout: &Layout<()>, max_lines: usize) -> (Vec<Vec<PlacedGlyph>>, Vec<(f32, f32, f32)>) {
        let mut lines = Vec::new();
        let mut extents = Vec::new();
        for line in layout.lines().take(max_lines) {
            let m = line.metrics();
            extents.push((m.baseline, m.line_height, m.advance - m.hanging_advance));
            let mut glyphs = Vec::new();
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(run) = item {
                    let font = self.font_id(run.run().font());
                    let size = run.run().font_size();
                    for g in run.positioned_glyphs() {
                        glyphs.push(PlacedGlyph { font, id: g.id, size, x: g.x, y: g.y, advance: g.advance });
                    }
                }
            }
            lines.push(glyphs);
        }
        (lines, extents)
    }

    fn ellipsis(&mut self, style: &TextStyle) -> Vec<PlacedGlyph> {
        if let Some(e) = self.ellipses.get(&style.key()) {
            return e.clone();
        }
        let mut layout = self.shape("…", style);
        layout.break_all_lines(None);
        let (lines, _) = self.glyphs_of(&layout, 1);
        let e = lines.into_iter().next().unwrap_or_default();
        self.ellipses.insert(style.key(), e.clone());
        e
    }

    /// Lays `text` out within `max_width` (logical px; None = one line per paragraph).
    pub fn layout(&mut self, text: &str, style: &TextStyle, max_width: Option<f32>) -> Arc<TextLayout> {
        let key = (text.to_owned(), style.key(), max_width.map_or(u32::MAX, f32::to_bits));
        if let Some(l) = self.cache.get(&key) {
            return l.clone();
        }
        let result = Arc::new(self.layout_uncached(text, style, max_width));
        if self.cache.len() >= CACHE_LIMIT {
            self.cache.clear();
        }
        self.cache.insert(key, result.clone());
        result
    }

    fn layout_uncached(&mut self, text: &str, style: &TextStyle, max_width: Option<f32>) -> TextLayout {
        if text.is_empty() {
            return TextLayout::default();
        }
        let mut layout = self.shape(text, style);
        let single = style.max_lines == 1;
        layout.break_all_lines(if single { None } else { max_width });
        if !single {
            let align = match style.align {
                Align::Start => Alignment::Start,
                Align::Center => Alignment::Center,
                Align::End => Alignment::End,
            };
            layout.align(align, AlignmentOptions::default());
        }
        let total = layout.len();
        let keep = if style.max_lines == 0 { total } else { total.min(style.max_lines as usize) };
        let (mut lines, extents) = self.glyphs_of(&layout, keep);
        let line_w = |g: &[PlacedGlyph]| g.last().map_or(0.0, |l| l.x + l.advance) - g.first().map_or(0.0, |f| f.x);
        let too_wide = single && max_width.is_some_and(|w| lines.first().is_some_and(|l| l.last().is_some_and(|g| g.x + g.advance > w + 0.5)));
        let truncated = keep < total || too_wide;
        if truncated
            && let Some(last) = lines.last_mut()
        {
            let ell = self.ellipsis(style);
            let ell_w: f32 = ell.iter().map(|g| g.advance).sum();
            let limit = max_width.unwrap_or(f32::INFINITY) - ell_w;
            while last.last().is_some_and(|g| g.x + g.advance > limit) {
                last.pop();
            }
            let baseline = extents.last().map_or(0.0, |e| e.0);
            let pen = last.last().map_or(last.first().map_or(0.0, |g| g.x), |g| g.x + g.advance);
            let y = last.first().map_or(baseline, |g| g.y);
            let mut x = pen;
            for g in ell {
                last.push(PlacedGlyph { x, y, ..g });
                x += g.advance;
            }
        }
        let mut widths: Vec<f32> = extents.iter().map(|e| e.2).collect();
        if truncated
            && let (Some(w), Some(l)) = (widths.last_mut(), lines.last())
        {
            *w = line_w(l);
        }
        let mut width = widths.iter().copied().fold(0.0, f32::max);
        if single && let Some(w) = max_width {
            width = width.min(w);
            let shift = match style.align {
                Align::Start => 0.0,
                Align::Center => ((w - width) / 2.0).max(0.0),
                Align::End => (w - width).max(0.0),
            };
            if shift > 0.0 {
                for g in lines.iter_mut().flatten() {
                    g.x += shift;
                }
            }
        }
        let height = if keep == total { layout.height() } else { extents.iter().map(|e| e.1).sum() };
        TextLayout { width, height, lines: keep as u32, truncated, glyphs: lines.into_iter().flatten().collect() }
    }

    /// The glyph's bitmap in the atlas, rasterizing it the first time, at `size_px`
    /// device px and a horizontal subpixel offset `frac` (0..1). None for blank glyphs.
    pub fn glyph(&mut self, font: u32, id: u32, size_px: f32, frac: f32) -> Option<AtlasEntry> {
        let bin = ((frac * SUBPIXEL_BINS).floor() as u8).min(SUBPIXEL_BINS as u8 - 1);
        let key = GlyphKey { font, id, size_bits: size_px.to_bits(), bin };
        if let Some(e) = self.atlas.entries.get(&key) {
            return *e;
        }
        let entry = self.rasterize(key, size_px, bin as f32 / SUBPIXEL_BINS);
        self.atlas.entries.insert(key, entry);
        entry
    }

    fn rasterize(&mut self, key: GlyphKey, size_px: f32, offset: f32) -> Option<AtlasEntry> {
        let data = self.fonts.get(key.font as usize)?.clone();
        let font = swash::FontRef::from_index(data.data.data(), data.index as usize)?;
        let mut scaler = self.scx.builder(font).size(size_px).hint(false).build();
        let image = Render::new(&[Source::ColorOutline(0), Source::ColorBitmap(StrikeWith::BestFit), Source::Outline])
            .format(Format::Alpha)
            .offset(Vector::new(offset, 0.0))
            .render(&mut scaler, key.id as u16)?;
        let (w, h) = (image.placement.width, image.placement.height);
        if w == 0 || h == 0 {
            return None;
        }
        // Colour glyphs (emoji) become coverage for now: the atlas holds one channel.
        let mask: Vec<u8> = match image.content {
            Content::Color => image.data.chunks_exact(4).map(|p| p[3]).collect(),
            Content::SubpixelMask => image.data.chunks_exact(4).map(|p| ((p[0] as u16 + p[1] as u16 + p[2] as u16) / 3) as u8).collect(),
            Content::Mask => image.data,
        };
        let (x, y) = self.atlas.alloc(w, h)?;
        self.atlas.blit(x, y, w, h, &mask);
        Some(AtlasEntry { x, y, w, h, left: image.placement.left, top: image.placement.top })
    }

    /// The atlas as it is now (cheap: shared until the next glyph is added).
    pub fn atlas(&self) -> Arc<AtlasImage> {
        self.atlas.image.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lays_out_and_wraps() {
        let mut e = TextEngine::new();
        let s = TextStyle::default();
        let one = e.layout("Hello world", &s, None);
        assert!(one.width > 50.0 && one.width < 100.0, "{}", one.width);
        assert_eq!(one.lines, 1);
        let wrapped = e.layout("Hello world, this wraps onto more lines", &s, Some(80.0));
        assert!(wrapped.lines >= 3, "{}", wrapped.lines);
        assert!(wrapped.width <= 80.0 + 0.5);
        assert!(wrapped.height > one.height * 2.5);
    }

    #[test]
    fn max_lines_cuts_off_with_an_ellipsis() {
        let mut e = TextEngine::new();
        let s = TextStyle { max_lines: 1, ..TextStyle::default() };
        let t = e.layout("A subject line that is far too long to fit in the box", &s, Some(120.0));
        assert!(t.truncated && t.lines == 1);
        assert!(t.width <= 120.0 + 0.5, "{}", t.width);
        let ell = e.ellipsis(&s);
        assert_eq!(t.glyphs.last().map(|g| g.id), ell.last().map(|g| g.id), "ends in …");
        let short = e.layout("Short", &s, Some(120.0));
        assert!(!short.truncated);
        let two = e.layout("one two three four five six seven eight nine ten", &TextStyle { max_lines: 2, ..s }, Some(60.0));
        assert!(two.truncated && two.lines == 2);
    }

    #[test]
    fn centred_single_line() {
        let mut e = TextEngine::new();
        let s = TextStyle { max_lines: 1, align: Align::Center, ..TextStyle::default() };
        let t = e.layout("Hi", &s, Some(200.0));
        let first = t.glyphs[0].x;
        assert!(first > 80.0 && first < 100.0, "{first}");
    }

    #[test]
    fn heavier_weights_are_wider_and_layouts_are_cached() {
        let mut e = TextEngine::new();
        let regular = e.layout("Mantou", &TextStyle::default(), None);
        let bold = e.layout("Mantou", &TextStyle { weight: 700.0, ..TextStyle::default() }, None);
        assert!(bold.width > regular.width);
        let again = e.layout("Mantou", &TextStyle::default(), None);
        assert!(Arc::ptr_eq(&regular, &again));
    }

    #[test]
    fn glyphs_rasterize_into_the_atlas() {
        let mut e = TextEngine::new();
        let t = e.layout("Ag", &TextStyle { size: 24.0, ..TextStyle::default() }, None);
        let v0 = e.atlas().version;
        let g = t.glyphs[0];
        let entry = e.glyph(g.font, g.id, 24.0, 0.0).expect("A has ink");
        assert!(entry.w > 5 && entry.h > 10, "{entry:?}");
        assert!(e.atlas().version > v0);
        let atlas = e.atlas();
        let ink: u32 = (0..entry.h).map(|y| (0..entry.w).map(|x| atlas.pixels[((entry.y + y) * atlas.width + entry.x + x) as usize] as u32).sum::<u32>()).sum();
        assert!(ink > 1000, "coverage {ink}");
        assert_eq!(e.glyph(g.font, g.id, 24.0, 0.0), Some(entry), "cached");
        let space = e.layout(" ", &TextStyle::default(), None);
        if let Some(sp) = space.glyphs.first() {
            assert_eq!(e.glyph(sp.font, sp.id, 14.0, 0.0), None, "blank");
        }
    }

    #[test]
    fn the_atlas_grows_when_full() {
        let mut e = TextEngine::new();
        let t = e.layout("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", &TextStyle { size: 64.0, ..TextStyle::default() }, None);
        for g in &t.glyphs {
            for bin in 0..4 {
                e.glyph(g.font, g.id, 64.0, bin as f32 / 4.0);
            }
        }
        assert!(e.atlas().width > ATLAS_START);
    }
}
