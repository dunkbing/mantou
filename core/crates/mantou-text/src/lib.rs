//! Mantou's text (design §8.5): lays text out with parley, rasterizes glyphs
//! with swash into a coverage atlas, and ships the Inter font so text looks
//! the same on every platform. System fonts are the fallback for what Inter
//! lacks (emoji, other scripts). Layouts are cached by their text, style and
//! width. No platform or GPU dependencies.

pub mod editor;
pub use editor::Editor;

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
/// Inter, then the platform's colour emoji font (CSS's `emoji` generic: Apple
/// Color Emoji, Segoe UI Emoji, Noto Color Emoji), then the system's: before
/// the system font, which may have plain outlines for some emoji (DejaVu does).
pub(crate) const FAMILY: &str = "Inter, emoji, system-ui, sans-serif";

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
    /// A font family id (TextEngine::set_family); 0 = the default fonts.
    pub family: u32,
    /// Px added after each character.
    pub letter_spacing: f32,
    pub transform: Transform,
    pub decoration: Decoration,
    /// One line, however wide.
    pub nowrap: bool,
    /// What is cut off ends in an ellipsis (true) or just stops (false).
    pub ellipsis: bool,
    pub word_break: WordBreakMode,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WordBreakMode {
    #[default]
    Normal,
    BreakAll,
    KeepAll,
    BreakWord,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Transform {
    #[default]
    None,
    Upper,
    Lower,
    Capitalize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Decoration {
    #[default]
    None,
    Underline,
    LineThrough,
}

impl Transform {
    fn apply(self, text: &str) -> String {
        match self {
            Transform::None => text.to_owned(),
            Transform::Upper => text.to_uppercase(),
            Transform::Lower => text.to_lowercase(),
            Transform::Capitalize => {
                let mut start = true;
                text.chars()
                    .flat_map(|c| {
                        let up = start && c.is_alphabetic();
                        start = !c.is_alphanumeric() && c != '\'';
                        if up { c.to_uppercase().collect::<Vec<_>>() } else { vec![c] }
                    })
                    .collect()
            }
        }
    }
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle { size: 14.0, weight: 400.0, line_height: 0.0, align: Align::Start, max_lines: 0, italic: false, family: 0, letter_spacing: 0.0, transform: Transform::None, decoration: Decoration::None, nowrap: false, ellipsis: true, word_break: WordBreakMode::Normal }
    }
}

impl TextStyle {
    /// What a span's style changes in the layout.
    fn span_key(&self) -> [u32; 6] {
        [self.family, self.size.to_bits(), self.weight.to_bits(), self.italic as u32, self.letter_spacing.to_bits(), self.decoration as u32]
    }

    fn key(&self) -> [u32; 9] {
        [
            self.family,
            self.size.to_bits(),
            self.weight.to_bits(),
            self.line_height.to_bits(),
            self.align as u32,
            self.max_lines,
            self.italic as u32,
            self.letter_spacing.to_bits(),
            self.transform as u32 | (self.decoration as u32) << 4 | (self.nowrap as u32) << 8 | (self.ellipsis as u32) << 9 | (self.word_break as u32) << 10,
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
    /// The span it's in: 0 = the text's own style, n = `spans[n - 1]` of `layout_rich`.
    pub span: u32,
    /// What the font lacks and is drawn in: a slant (degrees; italic in a font
    /// without an italic face) and emboldening (a weight it doesn't have).
    pub skew: f32,
    pub embolden: bool,
}

/// Part of rich text set in its own style: bytes `start..end` of the text.
/// Of its style, the font (family, size, weight, italic), letter spacing and
/// decoration count; the rest (alignment, lines, wrapping) is the text's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub style: TextStyle,
}

/// A stretch of one line in one span: [x0, y0, x1, y1] in logical px from
/// the layout's top left, from the line box's top to its bottom.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunBox {
    pub rect: [f32; 4],
    pub span: u32,
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
    /// Underlines and strike-throughs, as boxes in logical px from the layout's top left, in their span's colour.
    pub decorations: Vec<RunBox>,
    /// Each line's stretches of one span (for highlights and finding the span at a point).
    pub runs: Vec<RunBox>,
}

impl TextLayout {
    /// The span at a point (logical px from the layout's top left): 0 for the text's own style, None off the text.
    pub fn span_at(&self, x: f32, y: f32) -> Option<u32> {
        self.runs.iter().find(|r| x >= r.rect[0] && x < r.rect[2] && y >= r.rect[1] && y < r.rect[3]).map(|r| r.span)
    }
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
    /// In the colour atlas (an emoji's own colours), not the coverage one.
    pub color: bool,
}

/// Atlas versions, unique in the process: a renderer shared by several
/// instances (headless ones) tells their atlases apart by version.
static NEXT_VERSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_version() -> u64 {
    NEXT_VERSION.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// The coverage atlas (one byte per texel). Renderers upload it whenever `version` changes.
#[derive(Clone, Debug, PartialEq)]
pub struct AtlasImage {
    pub width: u32,
    pub height: u32,
    /// One byte of coverage per texel; the colour atlas has four (RGBA8, straight alpha).
    pub pixels: Vec<u8>,
    pub version: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct GlyphKey {
    font: u32,
    id: u32,
    size_bits: u32,
    bin: u8,
    /// Synthesized: the slant's bits, and emboldening.
    skew_bits: u32,
    embolden: bool,
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
    /// Bytes per texel: 1 (coverage) or 4 (colour).
    bpp: usize,
    shelves: Vec<Shelf>,
    next_y: u32,
    entries: HashMap<GlyphKey, Option<AtlasEntry>>,
}

impl Atlas {
    fn new(bpp: usize, side: u32) -> Atlas {
        Atlas {
            image: Arc::new(AtlasImage { width: side, height: side, pixels: vec![0; side as usize * side as usize * bpp], version: next_version() }),
            bpp,
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
        let (b, ow, nw) = (self.bpp, old.width as usize * self.bpp, w as usize * self.bpp);
        let mut pixels = vec![0; w as usize * h as usize * b];
        for y in 0..old.height as usize {
            pixels[y * nw..y * nw + ow].copy_from_slice(&old.pixels[y * ow..(y + 1) * ow]);
        }
        self.image = Arc::new(AtlasImage { width: w, height: h, pixels, version: next_version() });
    }

    fn blit(&mut self, x: u32, y: u32, w: u32, h: u32, data: &[u8]) {
        let b = self.bpp;
        let img = Arc::make_mut(&mut self.image);
        let row_len = w as usize * b;
        for row in 0..h as usize {
            let dst = ((y as usize + row) * img.width as usize + x as usize) * b;
            img.pixels[dst..dst + row_len].copy_from_slice(&data[row * row_len..(row + 1) * row_len]);
        }
        img.version = next_version();
    }
}

/// Swash draws colour glyphs premultiplied; images are uploaded with straight alpha.
fn straight(mut rgba: Vec<u8>) -> Vec<u8> {
    for p in rgba.chunks_exact_mut(4) {
        let a = p[3] as u32;
        if a > 0 && a < 255 {
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    rgba
}

/// Text, style, width, and the spans' ranges and layout styles.
type LayoutKey = (String, [u32; 9], u32, Vec<(u32, u32, [u32; 6])>);

/// Text layout and glyph rasterization for one tree.
pub struct TextEngine {
    fcx: FontContext,
    lcx: LayoutContext<u32>,
    scx: ScaleContext,
    font_ids: HashMap<(u64, u32), u32>,
    fonts: Vec<FontData>,
    atlas: Atlas,
    /// Colour glyphs (emoji), RGBA; its entries live in `atlas.entries` with the others.
    color_atlas: Atlas,
    /// Layouts by text, style and width, in two generations: when the newer
    /// one fills up it becomes the older, so a working set a little larger
    /// than the limit keeps most of its hits instead of losing them all.
    cache: HashMap<LayoutKey, Arc<TextLayout>>,
    older: HashMap<LayoutKey, Arc<TextLayout>>,
    ellipses: HashMap<[u32; 9], Vec<PlacedGlyph>>,
    /// Font family lists by id, each ending in the default ones (FAMILY).
    families: HashMap<u32, String>,
    /// Layouts computed (cache misses), for tests and stats.
    uncached: u64,
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
            atlas: Atlas::new(1, ATLAS_START),
            color_atlas: Atlas::new(4, 256),
            cache: HashMap::new(),
            older: HashMap::new(),
            ellipses: HashMap::new(),
            families: HashMap::new(),
            uncached: 0,
        }
    }

    /// Defines a family id for TextStyle::family: names tried in order, then Mantou's own fonts.
    pub fn set_family(&mut self, id: u32, names: &str) {
        let source = format!("{names}, {FAMILY}");
        if self.families.get(&id) != Some(&source) {
            self.families.insert(id, source);
            self.forget_layouts();
        }
    }

    /// The family list a style's text is set in.
    pub(crate) fn family_source(&self, id: u32) -> &str {
        self.families.get(&id).map_or(FAMILY, String::as_str)
    }

    /// Registers a font file (TTF, OTF or a collection) with this engine.
    /// Returns the family names it holds; none means it wasn't a font.
    pub fn register_font(&mut self, data: Vec<u8>) -> Vec<String> {
        let added = self.fcx.collection.register_fonts(Blob::new(Arc::new(data)), None);
        let names: Vec<String> = added.iter().filter_map(|(id, _)| self.fcx.collection.family_name(*id).map(str::to_owned)).collect();
        if !names.is_empty() {
            self.forget_layouts(); // a family, or the fallback for some text, may have changed
        }
        names
    }

    fn forget_layouts(&mut self) {
        self.cache.clear();
        self.older.clear();
        self.ellipses.clear();
    }

    /// How many layouts were computed rather than found in the cache.
    pub fn uncached_layouts(&self) -> u64 {
        self.uncached
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

    fn shape(&mut self, text: &str, style: &TextStyle, spans: &[Span]) -> Layout<u32> {
        let family = self.family_source(style.family).to_owned();
        let span_families: Vec<Option<String>> = spans.iter().map(|sp| (sp.style.family != style.family).then(|| self.family_source(sp.style.family).to_owned())).collect();
        let mut b = self.lcx.ranged_builder(&mut self.fcx, text, 1.0, false);
        b.push_default(StyleProperty::FontFamily(FontFamily::Source(Cow::Owned(family.clone()))));
        b.push_default(StyleProperty::FontSize(style.size));
        b.push_default(StyleProperty::FontWeight(FontWeight::new(style.weight)));
        b.push_default(StyleProperty::FontStyle(if style.italic { FontStyle::Italic } else { FontStyle::Normal }));
        match style.word_break {
            WordBreakMode::Normal => {}
            WordBreakMode::BreakAll => b.push_default(StyleProperty::WordBreak(parley::WordBreak::BreakAll)),
            WordBreakMode::KeepAll => b.push_default(StyleProperty::WordBreak(parley::WordBreak::KeepAll)),
            WordBreakMode::BreakWord => b.push_default(StyleProperty::OverflowWrap(parley::OverflowWrap::Anywhere)),
        }
        if style.letter_spacing != 0.0 {
            b.push_default(StyleProperty::LetterSpacing(style.letter_spacing));
        }
        b.push_default(StyleProperty::LineHeight(if style.line_height > 0.0 {
            LineHeight::FontSizeRelative(style.line_height)
        } else {
            LineHeight::MetricsRelative(1.0)
        }));
        // An emoji asked for with U+FE0F (❤️ rather than ❤): fallback goes by character, and
        // Inter has plain symbols for some, so set it without Inter and the emoji font wins.
        let families: Vec<String> = std::iter::once(family.clone()).chain(span_families.iter().map(|f| f.clone().unwrap_or_else(|| family.clone()))).collect();
        let mut emoji_ranges = Vec::new();
        for (i, c) in text.char_indices() {
            if c != '\u{fe0f}' {
                continue;
            }
            let start = text[..i].char_indices().next_back().map_or(i, |(j, _)| j);
            let span = spans.iter().position(|sp| (sp.start as usize..sp.end as usize).contains(&start)).map_or(0, |k| k + 1);
            let without_inter: Vec<&str> = families[span].split(',').map(str::trim).filter(|f| !f.eq_ignore_ascii_case("Inter")).collect();
            emoji_ranges.push((start..i + c.len_utf8(), without_inter.join(", ")));
        }
        for (i, (sp, fam)) in spans.iter().zip(span_families).enumerate() {
            let range = (sp.start as usize).min(text.len())..(sp.end as usize).min(text.len());
            if range.is_empty() {
                continue;
            }
            let t = &sp.style;
            b.push(StyleProperty::Brush(i as u32 + 1), range.clone());
            if let Some(f) = fam {
                b.push(StyleProperty::FontFamily(FontFamily::Source(Cow::Owned(f))), range.clone());
            }
            if t.size != style.size {
                b.push(StyleProperty::FontSize(t.size), range.clone());
            }
            if t.weight != style.weight {
                b.push(StyleProperty::FontWeight(FontWeight::new(t.weight)), range.clone());
            }
            if t.italic != style.italic {
                b.push(StyleProperty::FontStyle(if t.italic { FontStyle::Italic } else { FontStyle::Normal }), range.clone());
            }
            if t.letter_spacing != style.letter_spacing {
                b.push(StyleProperty::LetterSpacing(t.letter_spacing), range);
            }
        }
        for (range, fam) in emoji_ranges {
            b.push(StyleProperty::FontFamily(FontFamily::Source(Cow::Owned(fam))), range);
        }
        b.build(text)
    }

    /// Each kept line's glyphs, and its (baseline, line height, width without hanging whitespace, top, bottom).
    pub(crate) fn glyphs_of(&mut self, layout: &Layout<u32>, max_lines: usize) -> (Vec<Vec<PlacedGlyph>>, Vec<(f32, f32, f32, f32, f32)>) {
        let mut lines = Vec::new();
        let mut extents = Vec::new();
        for line in layout.lines().take(max_lines) {
            let m = line.metrics();
            extents.push((m.baseline, m.line_height, m.advance - m.hanging_advance, m.block_min_coord, m.block_max_coord));
            let mut glyphs = Vec::new();
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(run) = item {
                    let font = self.font_id(run.run().font());
                    let size = run.run().font_size();
                    let span = run.style().brush;
                    let synth = run.run().synthesis();
                    let (skew, embolden) = (synth.skew().unwrap_or(0.0), synth.embolden());
                    for g in run.positioned_glyphs() {
                        glyphs.push(PlacedGlyph { font, id: g.id, size, x: g.x, y: g.y, advance: g.advance, span, skew, embolden });
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
        let mut layout = self.shape("…", style, &[]);
        layout.break_all_lines(None);
        let (lines, _) = self.glyphs_of(&layout, 1);
        let e = lines.into_iter().next().unwrap_or_default();
        self.ellipses.insert(style.key(), e.clone());
        e
    }

    /// Lays `text` out within `max_width` (logical px; None = one line per paragraph).
    pub fn layout(&mut self, text: &str, style: &TextStyle, max_width: Option<f32>) -> Arc<TextLayout> {
        self.layout_rich(text, style, &[], max_width)
    }

    /// Lays out rich text: `spans` (byte ranges, in order, not overlapping) set parts of it in their own style.
    pub fn layout_rich(&mut self, text: &str, style: &TextStyle, spans: &[Span], max_width: Option<f32>) -> Arc<TextLayout> {
        let key = (text.to_owned(), style.key(), max_width.map_or(u32::MAX, f32::to_bits), spans.iter().map(|s| (s.start, s.end, s.style.span_key())).collect::<Vec<_>>());
        if let Some(l) = self.cache.get(&key) {
            return l.clone();
        }
        let result = match self.older.remove(&key) {
            Some(l) => l, // still in use: back to the newer generation
            None => {
                self.uncached += 1;
                Arc::new(self.layout_uncached(text, style, spans, max_width))
            }
        };
        if self.cache.len() >= CACHE_LIMIT {
            self.older = std::mem::take(&mut self.cache);
        }
        self.cache.insert(key, result.clone());
        result
    }

    fn layout_uncached(&mut self, text: &str, style: &TextStyle, spans: &[Span], max_width: Option<f32>) -> TextLayout {
        if text.is_empty() {
            return TextLayout::default();
        }
        let transformed;
        let mut moved = Vec::new();
        let (text, spans) = if style.transform == Transform::None {
            (text, spans)
        } else {
            // Upper-casing can change lengths (ß is SS): transform piece by piece, and move the spans with it.
            let mut out = String::with_capacity(text.len());
            let mut at = 0usize;
            let piece = |out: &mut String, from: usize, to: usize| {
                let (from, to) = (from.min(text.len()), to.min(text.len()).max(from.min(text.len())));
                if let Some(t) = text.get(from..to) {
                    out.push_str(&style.transform.apply(t));
                }
            };
            for sp in spans {
                piece(&mut out, at, sp.start as usize);
                let start = out.len() as u32;
                piece(&mut out, sp.start as usize, sp.end as usize);
                moved.push(Span { start, end: out.len() as u32, ..*sp });
                at = sp.end as usize;
            }
            piece(&mut out, at, text.len());
            transformed = out;
            (transformed.as_str(), moved.as_slice())
        };
        let mut layout = self.shape(text, style, spans);
        let single = style.max_lines == 1 || style.nowrap;
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
            let ell = if style.ellipsis { self.ellipsis(style) } else { Vec::new() };
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
        // Each line's stretches of one span, from the glyphs that were kept, and their decorations.
        // ponytail: decoration positions from the font size, not the font's own underline metrics.
        let style_of = |span: u32| if span == 0 { style } else { spans.get(span as usize - 1).map_or(style, |s| &s.style) };
        let mut runs: Vec<RunBox> = Vec::new();
        let mut decorations = Vec::new();
        for (l, e) in lines.iter().zip(&extents) {
            let mut i = 0;
            while i < l.len() {
                let span = l[i].span;
                let mut j = i;
                while j + 1 < l.len() && l[j + 1].span == span {
                    j += 1;
                }
                let (x0, x1) = (l[i].x, l[j].x + l[j].advance);
                runs.push(RunBox { rect: [x0, e.3, x1, e.4], span });
                let st = style_of(span);
                if st.decoration != Decoration::None {
                    let thickness = (st.size / 14.0).max(1.0);
                    let y = match st.decoration {
                        Decoration::Underline => l[i].y + st.size * 0.12,
                        _ => l[i].y - st.size * 0.3,
                    };
                    decorations.push(RunBox { rect: [x0, y, x1, y + thickness], span });
                }
                i = j + 1;
            }
        }
        TextLayout { width, height, lines: keep as u32, truncated, glyphs: lines.into_iter().flatten().collect(), decorations, runs }
    }

    /// The glyph's bitmap in the atlas, rasterizing it the first time, at `size_px`
    /// device px and a horizontal subpixel offset `frac` (0..1). None for blank glyphs.
    pub fn glyph(&mut self, font: u32, id: u32, size_px: f32, frac: f32) -> Option<AtlasEntry> {
        self.glyph_synth(font, id, size_px, frac, 0.0, false)
    }

    /// `glyph`, slanted by `skew` degrees and emboldened, as a `PlacedGlyph` asks.
    pub fn glyph_synth(&mut self, font: u32, id: u32, size_px: f32, frac: f32, skew: f32, embolden: bool) -> Option<AtlasEntry> {
        let bin = ((frac * SUBPIXEL_BINS).floor() as u8).min(SUBPIXEL_BINS as u8 - 1);
        let key = GlyphKey { font, id, size_bits: size_px.to_bits(), bin, skew_bits: skew.to_bits(), embolden };
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
        let mut render = Render::new(&[Source::ColorOutline(0), Source::ColorBitmap(StrikeWith::BestFit), Source::Outline]);
        render.format(Format::Alpha).offset(Vector::new(offset, 0.0));
        let skew = f32::from_bits(key.skew_bits);
        if skew != 0.0 {
            render.transform(Some(swash::zeno::Transform::skew(swash::zeno::Angle::from_degrees(skew), swash::zeno::Angle::ZERO)));
        }
        if key.embolden {
            render.embolden(size_px / 48.0);
        }
        let image = render.render(&mut scaler, key.id as u16)?;
        let (w, h) = (image.placement.width, image.placement.height);
        if w == 0 || h == 0 {
            return None;
        }
        // Colour glyphs (emoji) keep their colours, in an atlas of their own.
        if image.content == Content::Color {
            let (x, y) = self.color_atlas.alloc(w, h)?;
            self.color_atlas.blit(x, y, w, h, &straight(image.data));
            return Some(AtlasEntry { x, y, w, h, left: image.placement.left, top: image.placement.top, color: true });
        }
        let mask: Vec<u8> = match image.content {
            Content::SubpixelMask => image.data.chunks_exact(4).map(|p| ((p[0] as u16 + p[1] as u16 + p[2] as u16) / 3) as u8).collect(),
            _ => image.data,
        };
        let (x, y) = self.atlas.alloc(w, h)?;
        self.atlas.blit(x, y, w, h, &mask);
        Some(AtlasEntry { x, y, w, h, left: image.placement.left, top: image.placement.top, color: false })
    }

    /// The atlas as it is now (cheap: shared until the next glyph is added).
    /// The colour glyphs' atlas (RGBA8, straight alpha).
    pub fn color_atlas(&self) -> Arc<AtlasImage> {
        self.color_atlas.image.clone()
    }

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
    fn spans_set_parts_of_the_text_in_their_own_style() {
        let mut e = TextEngine::new();
        let base = TextStyle { size: 16.0, ..TextStyle::default() };
        let plain = e.layout("Hello brave world", &base, None);
        // "brave" (bytes 6..11) bold and underlined, "world" (12..17) twice the size.
        let spans = [
            Span { start: 6, end: 11, style: TextStyle { weight: 800.0, decoration: Decoration::Underline, ..base } },
            Span { start: 12, end: 17, style: TextStyle { size: 32.0, ..base } },
        ];
        let rich = e.layout_rich("Hello brave world", &base, &spans, None);
        assert!(rich.width > plain.width && rich.height > plain.height, "bold and bigger: {} × {} vs {} × {}", rich.width, rich.height, plain.width, plain.height);
        assert_eq!(rich.glyphs.iter().map(|g| g.span).collect::<Vec<_>>(), [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 2, 2, 2, 2, 2]);
        assert_eq!(rich.runs.iter().map(|r| r.span).collect::<Vec<_>>(), [0, 1, 0, 2]);
        assert_eq!(rich.decorations.len(), 1, "only the bold span is underlined");
        assert_eq!(rich.decorations[0].span, 1);
        let brave = rich.runs[1].rect;
        assert_eq!(rich.span_at((brave[0] + brave[2]) / 2.0, (brave[1] + brave[3]) / 2.0), Some(1));
        assert_eq!(rich.span_at(1.0, (brave[1] + brave[3]) / 2.0), Some(0));
        assert_eq!(rich.span_at(rich.width + 5.0, 1.0), None);
        // The same spans again: cached; colours aren't part of it, so a recolour lays nothing out.
        let n = e.uncached_layouts();
        e.layout_rich("Hello brave world", &base, &spans, None);
        assert_eq!(e.uncached_layouts(), n);
    }

    #[test]
    fn spans_follow_a_text_transform_that_changes_lengths() {
        let mut e = TextEngine::new();
        let base = TextStyle { transform: Transform::Upper, ..TextStyle::default() };
        // "ß" (2 bytes) upper-cases to "SS" (2 bytes) but "ŉ" (2 bytes) to "ʼN" (3 bytes): the span after it moves.
        let spans = [Span { start: 3, end: 5, style: TextStyle { weight: 800.0, ..base } }];
        let l = e.layout_rich("ŉ ab", &base, &spans, None);
        assert_eq!(l.glyphs.iter().filter(|g| g.span == 1).count(), 2, "\"AB\" is still the span");
    }

    #[test]
    fn emoji_are_drawn_in_their_own_colours() {
        let mut e = TextEngine::new();
        let font = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tests/fonts/MantouTestEmoji.ttf")).unwrap();
        assert_eq!(e.register_font(font), ["Mantou Test Emoji"]);
        e.set_family(1, "Mantou Test Emoji");
        let style = TextStyle { size: 32.0, family: 1, ..TextStyle::default() };
        // A skin tone, a ZWJ sequence, a flag and a variation selector: one glyph each.
        for (text, what) in [("😀", "plain"), ("👍🏽", "skin tone"), ("👩\u{200d}💻", "ZWJ sequence"), ("🇯🇵", "flag"), ("❤\u{fe0f}", "variation selector")] {
            let l = e.layout(text, &style, None);
            assert_eq!(l.glyphs.len(), 1, "{what}: {text}");
            let g = l.glyphs[0];
            let entry = e.glyph(g.font, g.id, 32.0, 0.0).expect("ink");
            assert!(entry.color, "{what} is a colour glyph");
            assert!(entry.w > 20 && entry.h > 20, "{what}: drawn at the size asked ({}×{})", entry.w, entry.h);
        }
        let atlas = e.color_atlas();
        assert_eq!(atlas.pixels.len(), (atlas.width * atlas.height * 4) as usize, "RGBA");
        let coloured = atlas.pixels.chunks_exact(4).filter(|p| p[3] > 200 && (p[0] as i32 - p[2] as i32).abs() > 60).count();
        assert!(coloured > 100, "it has colour, not just coverage: {coloured}");
    }

    #[test]
    fn atlases_of_different_engines_never_share_a_version() {
        // A renderer shared by headless instances uploads an atlas only when its version is new to it.
        let (mut a, mut b) = (TextEngine::new(), TextEngine::new());
        assert_ne!(a.atlas().version, b.atlas().version);
        for e in [&mut a, &mut b] {
            let t = e.layout("A", &TextStyle::default(), None);
            let g = t.glyphs[0];
            e.glyph(g.font, g.id, 16.0, 0.0);
        }
        assert_ne!(a.atlas().version, b.atlas().version);
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

