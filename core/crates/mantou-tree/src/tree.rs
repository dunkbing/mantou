//! The shadow tree (design §5.1, §8): nodes created by the Worker's ops,
//! laid out with Taffy (text measured by mantou-text), turned into a scene of
//! quads (rectangles and glyphs), and hit-tested.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use mantou_text::{Align, AtlasImage, PlacedGlyph, TextEngine, TextLayout, TextStyle};

use taffy::prelude::*;
use taffy::style::{AlignContent, AlignItems, Dimension, LengthPercentage, LengthPercentageAuto};

use crate::decode::{DecodeError, Length, Op, Value, decode};
use crate::protocol::{self as p, Prop, event_mask};

pub mod access;
mod anim;
mod hover;
mod html;
mod image;
mod focus;
mod input;
mod rich;
mod scroll;

use anim::Anims;
use input::Input;
use image::ImageNode;
use html::HtmlNode;
use scroll::{Drag, Request, ScrollState, Thumb};

pub use mantou_image::Pixels;

/// An image quad's texture: the scene's `images[id]`; `tint` draws its alpha in the quad's colour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImageRef {
    pub id: u32,
    pub tint: bool,
}
pub use input::{Clipboard, MemoryClipboard};

/// What the tree tells JS: about inputs, and boxes that listeners asked for.
#[derive(Clone, Debug, PartialEq)]
pub enum TreeEvent {
    Focus(u32),
    Blur(u32),
    Changed { id: u32, rev: u32, text: String },
    Submit(u32),
    /// A node with a Layout listener got a new box: x, y, width, height (logical px).
    Layout { id: u32, rect: [f32; 4] },
    /// A scroll view with a Scroll listener scrolled to this offset.
    Scroll { id: u32, offset: [f32; 2] },
    /// An Image's source was decoded: its natural size (logical px).
    ImageLoad { id: u32, size: [f32; 2] },
    ImageError { id: u32, message: String },
    /// An ANIMATE finished, or another animation of its property replaced it.
    AnimationEnd { id: u32, animation: u32 },
    /// The pointer came over a node with a Hover listener, or left it.
    PointerEnter(u32),
    PointerLeave(u32),
    /// A focused Input with a Select listener moved its caret or selection (UTF-16 units).
    Select { id: u32, anchor: u32, focus: u32 },
    /// A focused view was pressed from the keyboard (Enter or Space), at its centre (logical px).
    Press { id: u32, x: f32, y: f32 },
    /// An Html node's document asks for this URL (an image or a stylesheet).
    HtmlRequest { id: u32, url: String },
}

/// Selections of inputs whose style doesn't set one: #3b82f666.
const SELECTION: u32 = 0x66f6823b;

/// A gradient across a box: from the box's fill colour to `end`, through `mid` (colour and position 0 to 1) if given.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gradient {
    pub end: [f32; 4],
    /// Radians, CSS: 0 points up, clockwise. Unused when radial.
    pub angle: f32,
    pub mid: Option<([f32; 4], f32)>,
    /// From the centre out to the corners.
    pub radial: bool,
}

pub const NO_FILTER: [f32; 4] = [1.0, 1.0, 1.0, 0.0];

/// Two filters one after the other.
fn both(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] + b[3] - 2.0 * a[3] * b[3]]
}

/// What a box adds to a quad: corners and sides of their own, and a gradient.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Extra {
    /// Top left, top right, bottom right, bottom left radii (device px).
    pub radii: [f32; 4],
    /// Top, right, bottom, left border widths (device px).
    pub widths: [f32; 4],
    pub gradient: Option<Gradient>,
    /// Turned by this angle (radians, clockwise) about the quad's centre; only for plain filled shapes.
    pub rotation: f32,
    /// A strip between a slanted top edge and a horizontal one: the edge's y at the quad's left and right sides, and the other's y.
    pub trap: Option<[f32; 3]>,
    /// One pixel row of a filled shape: where its left and right edges are at the row's top and bottom (x, device px).
    pub span: Option<[f32; 4]>,
    /// The corner radius of the clip, in device px (0 = a plain rectangle).
    pub clip_radius: f32,
    /// Brightness, saturation, contrast and inversion the quad's colours are put through.
    pub filter: [f32; 4],
    /// The right, bottom and left border colours when they differ from `border_color` (the top's), like it.
    pub side_colors: Option<[[f32; 4]; 3]>,
}

impl Extra {
    pub const NONE: Extra = Extra { radii: [-1.0; 4], widths: [-1.0; 4], gradient: None, rotation: 0.0, trap: None, span: None, clip_radius: 0.0, filter: NO_FILTER, side_colors: None };
}

/// The quads of a CANVAS command list. Coordinates are logical px from `origin` (the content box's top left, in
/// the window's logical px), multiplied by `k` (the node's transform scale), then by `s` (device px per logical px).
/// Stops at a command it doesn't know or one that is cut short.
fn canvas_quads(words: &[u32], origin: (f32, f32), k: f32, s: f32, rgba: impl Fn(u32) -> [f32; 4], clip: [f32; 4], out: &mut Vec<Quad>, mut text: Option<&mut TextEngine>, base: &TextStyle, glyphs: &mut bool) {
    use crate::protocol::canvas_cmd as cmd;
    let dev = |x: f32, y: f32| ((origin.0 + x * k) * s, (origin.1 + y * k) * s);
    let len = |v: f32| (v * k * s).max(0.0);
    let rect_of = |x: f32, y: f32, w: f32, h: f32| {
        let (x0, y0) = dev(x, y);
        [x0, y0, x0 + len(w), y0 + len(h)]
    };
    let push = |out: &mut Vec<Quad>, rect: [f32; 4], color: [f32; 4], radius: f32, border: f32, border_color: [f32; 4], rotation: f32, trap: Option<[f32; 3]>| {
        if color[3] > 0.0 || (border > 0.0 && border_color[3] > 0.0) {
            out.push(Quad { rect, color, uv: [0.0; 4], clip, radius, border, border_color, shadow: None, image: None, extra: Extra { radii: [-1.0; 4], widths: [-1.0; 4], gradient: None, rotation, trap, span: None, ..Extra::NONE } });
        }
    };
    let clear = [0.0; 4];
    let mut i = 0;
    while i < words.len() {
        if words[i] == cmd::AREA {
            // Area baseline colour n, then n points: the region between the polyline and the baseline, as strips
            // one device pixel column apart at their sides (so neighbours meet exactly) with the polyline's edge on top.
            if i + 4 > words.len() {
                return;
            }
            let n = words[i + 3] as usize;
            if n > (words.len() - i - 4) / 2 {
                return;
            }
            let color = rgba(words[i + 2]);
            let yb = dev(0.0, f32::from_bits(words[i + 1])).1;
            let pts: Vec<(f32, f32)> = (0..n).map(|j| dev(f32::from_bits(words[i + 4 + 2 * j]), f32::from_bits(words[i + 5 + 2 * j]))).collect();
            for w in pts.windows(2) {
                let ((x0, y0), (x1, y1)) = (w[0], w[1]);
                if !(x0.is_finite() && x1.is_finite() && y0.is_finite() && y1.is_finite()) || x1 <= x0 {
                    continue;
                }
                // Cut where the line crosses the baseline, so each piece lies on one side of it.
                let mut cuts = vec![(x0, y0)];
                if (y0 - yb) * (y1 - yb) < 0.0 {
                    let t = (yb - y0) / (y1 - y0);
                    cuts.push((x0 + (x1 - x0) * t, yb));
                }
                cuts.push((x1, y1));
                for c in cuts.windows(2) {
                    let ((ax, ay), (bx, by)) = (c[0], c[1]);
                    let (sx0, sx1) = (ax.round(), bx.round());
                    if sx1 <= sx0 || color[3] <= 0.0 {
                        continue;
                    }
                    // The edge's height at the snapped sides.
                    let at = |x: f32| ay + (by - ay) * ((x - ax) / (bx - ax));
                    let (yl, yr) = (at(sx0), at(sx1));
                    let rect = [sx0, yl.min(yr).min(yb), sx1, yl.max(yr).max(yb)];
                    push(out, rect, color, 0.0, 0.0, [0.0; 4], 0.0, Some([yl, yr, yb]));
                }
            }
            i += 4 + 2 * n;
            continue;
        }
        if words[i] == cmd::FILL_POLY {
            // FillPoly colour n, then n points: filled (even-odd) one device pixel row at a time. Each row is a quad
            // that knows where the shape's edges cross its top and bottom, and the shader smooths them.
            if i + 3 > words.len() {
                return;
            }
            let n = words[i + 2] as usize;
            if n > (words.len() - i - 3) / 2 {
                return;
            }
            let color = rgba(words[i + 1]);
            let pts: Vec<(f32, f32)> = (0..n).map(|j| dev(f32::from_bits(words[i + 3 + 2 * j]), f32::from_bits(words[i + 4 + 2 * j]))).collect();
            i += 3 + 2 * n;
            if n < 3 || color[3] <= 0.0 || pts.iter().any(|p| !p.0.is_finite() || !p.1.is_finite()) {
                continue;
            }
            let top = pts.iter().map(|p| p.1).fold(f32::INFINITY, f32::min).floor().max(clip[1].floor());
            let bottom = pts.iter().map(|p| p.1).fold(f32::NEG_INFINITY, f32::max).ceil().min(clip[3].ceil());
            let mut hits: Vec<(f32, usize)> = Vec::new();
            let mut row = top;
            while row < bottom {
                let yc = row + 0.5;
                hits.clear();
                for e in 0..n {
                    let ((x0, y0), (x1, y1)) = (pts[e], pts[(e + 1) % n]);
                    if (y0 <= yc) != (y1 <= yc) {
                        hits.push((x0 + (x1 - x0) * (yc - y0) / (y1 - y0), e));
                    }
                }
                hits.sort_by(|a, b| a.0.total_cmp(&b.0));
                let at = |e: usize, y: f32| {
                    let ((x0, y0), (x1, y1)) = (pts[e], pts[(e + 1) % n]);
                    x0 + (x1 - x0) * (y - y0) / (y1 - y0)
                };
                for pair in hits.chunks_exact(2) {
                    let (l, r) = (pair[0].1, pair[1].1);
                    let edges = [at(l, row), at(l, row + 1.0), at(r, row), at(r, row + 1.0)];
                    let x0 = edges[0].min(edges[1]).floor() - 1.0;
                    let x1 = edges[2].max(edges[3]).ceil() + 1.0;
                    if x1 > x0 && x1 > clip[0] && x0 < clip[2] {
                        out.push(Quad { rect: [x0, row, x1, row + 1.0], color, uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None, extra: Extra { radii: [-1.0; 4], widths: [-1.0; 4], gradient: None, rotation: 0.0, trap: None, span: Some(edges), ..Extra::NONE } });
                    }
                }
                row += 1.0;
            }
            continue;
        }
        if words[i] == cmd::TEXT {
            // Text x y colour size weight nbytes, then the bytes: one line from its top left.
            if i + 7 > words.len() {
                return;
            }
            let nbytes = words[i + 6] as usize;
            let need = 7 + nbytes.div_ceil(4);
            if need > words.len() - i {
                return;
            }
            let a = |n: usize| f32::from_bits(words[i + n]);
            let bytes: Vec<u8> = words[i + 7..i + need].iter().flat_map(|w| w.to_le_bytes()).take(nbytes).collect();
            let color = rgba(words[i + 3]);
            if let Some(engine) = text.as_deref_mut()
                && a(1).is_finite()
                && a(2).is_finite()
                && a(4).is_finite()
                && color[3] > 0.0
            {
                let style = TextStyle { size: a(4).clamp(1.0, 1000.0), weight: words[i + 5] as f32, nowrap: true, max_lines: 0, ..*base };
                let layout = engine.layout(&String::from_utf8_lossy(&bytes), &style, None);
                *glyphs |= push_glyphs(out, engine, &layout.glyphs, (origin.0 + a(1) * k, origin.1 + a(2) * k), k, s, &[color], clip);
            }
            i += need;
            continue;
        }
        let need = match words[i] {
            cmd::FILL_RECT | cmd::CIRCLE => 6,
            cmd::STROKE_RECT | cmd::LINE | cmd::ROUND_RECT => 7,
            cmd::STROKE_CIRCLE => 6,
            _ => return,
        };
        // FillRect: id x y w h colour (6); Circle: id cx cy r colour (5)
        let need = if words[i] == cmd::CIRCLE { 5 } else { need };
        if i + need > words.len() {
            return;
        }
        let a = |n: usize| f32::from_bits(words[i + n]);
        let col = |n: usize| rgba(words[i + n]);
        match words[i] {
            cmd::FILL_RECT => push(out, rect_of(a(1), a(2), a(3), a(4)), col(5), 0.0, 0.0, clear, 0.0, None),
            cmd::STROKE_RECT => push(out, rect_of(a(1), a(2), a(3), a(4)), clear, 0.0, len(a(5)), col(6), 0.0, None),
            cmd::ROUND_RECT => push(out, rect_of(a(1), a(2), a(3), a(4)), col(6), len(a(5)), 0.0, clear, 0.0, None),
            cmd::CIRCLE => {
                let r = a(3).max(0.0);
                push(out, rect_of(a(1) - r, a(2) - r, 2.0 * r, 2.0 * r), col(4), len(r), 0.0, clear, 0.0, None)
            }
            cmd::STROKE_CIRCLE => {
                let r = a(3).max(0.0);
                push(out, rect_of(a(1) - r, a(2) - r, 2.0 * r, 2.0 * r), clear, len(r), len(a(4)), col(5), 0.0, None)
            }
            _ => {
                // A line: a thin rectangle along it, turned to its direction, about its middle.
                let ((x0, y0), (x1, y1)) = (dev(a(1), a(2)), dev(a(3), a(4)));
                let (dx, dy) = (x1 - x0, y1 - y0);
                let l = dx.hypot(dy);
                if l > 0.0 {
                    let w = len(a(5));
                    let (mx, my) = ((x0 + x1) * 0.5, (y0 + y1) * 0.5);
                    push(out, [mx - l / 2.0, my - w / 2.0, mx + l / 2.0, my + w / 2.0], col(6), 0.0, 0.0, clear, dy.atan2(dx), None);
                }
            }
        }
        i += need;
    }
}

/// One quad, in device pixels: a filled rectangle, or a glyph from the atlas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quad {
    /// x0, y0, x1, y1, snapped to device pixels.
    pub rect: [f32; 4],
    /// sRGB, straight alpha, 0–1 (opacity already applied).
    pub color: [f32; 4],
    /// The glyph's texels in the atlas (x0, y0, x1, y1); all zero for a filled rectangle.
    pub uv: [f32; 4],
    /// Only pixels inside this rectangle are drawn (device px).
    pub clip: [f32; 4],
    /// Corner radius and border width (device px); 0 for glyphs.
    pub radius: f32,
    pub border: f32,
    /// The border's colour, like `color`.
    pub border_color: [f32; 4],
    /// A box shadow: `rect` is the shadow's shape (box offset and spread),
    /// blurred by this Gaussian sigma (device px); the renderer draws past
    /// `rect` as far as the blur reaches.
    pub shadow: Option<f32>,
    /// An image: `uv` are texels of this image's pixels instead of the glyph atlas.
    pub image: Option<ImageRef>,
    /// Corners, sides and gradient; negative radii and widths mean `radius` and `border`.
    pub extra: Extra,
}

impl Quad {
    pub fn is_glyph(&self) -> bool {
        self.uv[2] > self.uv[0] && self.image.is_none()
    }
}

pub const NO_CLIP: [f32; 4] = [-1e9, -1e9, 1e9, 1e9];

/// What the renderer draws for one frame, in paint order. Immutable once built.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scene {
    pub clear: [f32; 4],
    pub quads: Vec<Quad>,
    /// Physical size it was laid out for.
    pub size_px: (u32, u32),
    /// The glyph atlas the glyph quads point into.
    pub atlas: Option<Arc<AtlasImage>>,
    /// The pixels image quads point into, by `ImageRef::id`.
    pub images: HashMap<u32, Arc<Pixels>>,
}

impl Scene {
    /// A stable text form, one line per item, for snapshots and debugging.
    pub fn dump(&self) -> String {
        let hex = |c: [f32; 4]| {
            let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            format!("#{:02x}{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]), b(c[3]))
        };
        let mut out = format!("size {}x{}\nclear {}\n", self.size_px.0, self.size_px.1, hex(self.clear));
        let mut glyphs = 0;
        for q in &self.quads {
            if q.is_glyph() {
                glyphs += 1;
                continue;
            }
            let [x0, y0, x1, y1] = q.rect;
            if let Some(img) = q.image {
                let p = &self.images[&img.id];
                out.push_str(&format!("image {x0} {y0} {x1} {y1} {}x{}{}\n", p.width, p.height, if img.tint { format!(" tint {}", hex(q.color)) } else { String::new() }));
                continue;
            }
            if let Some(sigma) = q.shadow {
                out.push_str(&format!("shadow {x0} {y0} {x1} {y1} {} sigma {sigma}", hex(q.color)));
                if q.radius > 0.0 {
                    out.push_str(&format!(" radius {}", q.radius));
                }
                out.push('\n');
                continue;
            }
            out.push_str(&format!("quad {x0} {y0} {x1} {y1} {}", hex(q.color)));
            if q.radius > 0.0 {
                out.push_str(&format!(" radius {}", q.radius));
            }
            if q.border > 0.0 {
                out.push_str(&format!(" border {} {}", q.border, hex(q.border_color)));
            }
            if q.extra.radii.iter().any(|r| *r >= 0.0) {
                out.push_str(&format!(" radii {:?}", q.extra.radii));
            }
            if q.extra.widths.iter().any(|w| *w >= 0.0) {
                out.push_str(&format!(" widths {:?}", q.extra.widths));
            }
            if let Some(e) = q.extra.span {
                out.push_str(&format!(" span {} {} {} {}", e[0], e[1], e[2], e[3]));
            }
            if let Some([yl, yr, yb]) = q.extra.trap {
                out.push_str(&format!(" strip {yl} {yr} {yb}"));
            }
            if q.extra.rotation != 0.0 {
                out.push_str(&format!(" rotate {}", q.extra.rotation.to_degrees().round()));
            }
            if let Some(g) = q.extra.gradient {
                out.push_str(&format!(" gradient {} {}", hex(g.end), g.angle.to_degrees().round()));
                if let Some((c, at)) = g.mid {
                    out.push_str(&format!(" mid {} {}", hex(c), (at * 100.0).round()));
                }
                if g.radial {
                    out.push_str(" radial");
                }
            }
            out.push('\n');
        }
        if glyphs > 0 {
            out.push_str(&format!("glyphs {glyphs}\n"));
        }
        out
    }
}

/// What applying a batch did.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ApplyReport {
    pub ops: usize,
    /// Ops skipped because they made no sense (unknown ids, cycles…), with why.
    pub errors: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TreeStats {
    /// Layout passes run.
    pub layouts: u64,
    /// Ops applied.
    pub ops: u64,
    /// Scenes built.
    pub scenes: u64,
    /// Text layouts computed (not reused from a node or the cache).
    pub text_layouts: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Visual {
    /// Radii and widths of single corners and sides, each stored plus one so that 0 means "not set".
    radii_p1: [f32; 4],
    widths_p1: [f32; 4],
    /// The gradient's end colour (RGBA8) and angle in degrees; a transparent end colour means no gradient.
    gradient: u32,
    gradient_angle: f32,
    /// The middle stop's colour (0 = none) and its position, stored minus 0.5.
    gradient_mid: u32,
    gradient_mid_at: f32,
    gradient_radial: bool,
    z: i32,
    /// 0 relative, 1 absolute, 2 fixed, 3 sticky.
    position: u8,
    /// top, right, bottom, left in px, as set (None: auto or a percentage).
    inset: [Option<f32>; 4],
    no_pointer: bool,
    /// `userSelect: text`.
    user_select: bool,
    background: u32,
    radius: f32,
    border: f32,
    border_color: u32,
    opacity: f32,
    hidden: bool,
    clips: bool,
    color: u32,
    text: TextStyle,
    placeholder_color: Option<u32>,
    caret_color: Option<u32>,
    selection_color: Option<u32>,
    /// The focus ring's colour and offset (None: #3b82f6 and 2 px).
    focus_ring_color: Option<u32>,
    focus_ring_offset: Option<f32>,
    /// overflow: "scroll".
    scrolls: bool,
    /// The node's own or shared style set `color` (an Image is then tinted with it).
    color_set: bool,
    fit: u32,
    /// Box shadow: x, y, blur, spread (logical px) and colour (0 alpha = none).
    shadow: [f32; 4],
    shadow_color: u32,
    no_scrollbar: bool,
    scrollbar_color: Option<u32>,
    /// The transform: a translation (logical px) and a scale about the box's centre.
    translate: [f32; 2],
    scale: f32,
    /// Degrees clockwise, about the box's centre.
    rotate: f32,
    /// `brightness`, `saturate` and `contrast` (1 = unchanged), `invert` (0 = unchanged).
    brightness: f32,
    saturate: f32,
    contrast: f32,
    invert: f32,
    /// The top, right, bottom and left border colours (0 = `border_color`).
    side_colors: [u32; 4],
    /// The `cursor` style (protocol::cursor; AUTO = whatever's below).
    cursor: u32,
}

struct Node {
    taffy: NodeId,
    kind: u32,
    text: String,
    parent: Option<u32>,
    children: Vec<u32>,
    own: BTreeMap<Prop, Value>,
    shared: u32,
    listen: u32,
    v: Visual,
    input: Option<Box<Input>>,
    /// The box last sent in a LAYOUT event (x, y, width, height), for Layout listeners.
    reported: Option<[f32; 4]>,
    /// FOCUS_SCOPE flags (0 = not a focus scope).
    scope: u32,
    /// What ACCESS told assistive technology (role, flags, label).
    access: Option<access::Access>,
    /// What CANVAS drew over the background (commands as words).
    canvas: Vec<u32>,
    /// A scroll view's offset and limits (overflow: "scroll").
    scroll: Option<ScrollState>,
    /// An Image node's source.
    image: Option<Box<ImageNode>>,
    html: Option<Box<HtmlNode>>,
    /// A Text node's layout at the width it was drawn at (its bits), reused
    /// while its text, style and width stay the same.
    drawn: RefCell<Option<(u32, Arc<TextLayout>)>>,
    /// Its transitions and running animations.
    anim: Option<Box<Anims>>,
    /// Where layout last put it, relative to its parent (for `transition: { layout }`).
    last_loc: Option<[f32; 2]>,
    /// It has been placed at least once (a transition needs a look to start from).
    placed: bool,
    /// A Text's runs in spans (TEXT_RUNS).
    rich: Option<Box<rich::Rich>>,
    /// A span: the Text whose runs it's in.
    span_of: Option<u32>,
    /// FOCUSABLE: (flags, Tab order); flags 0 = it can't take the focus.
    focusable: (u32, u32),
}

/// A laid-out box in paint order: the node, its border box and content box
/// (logical px), and the clip its ancestors put on it (logical px).
/// The nodes by id (FxHash: looked up for every box, every frame).
type Nodes = rustc_hash::FxHashMap<u32, Node>;

#[derive(Clone, Copy)]
struct LaidOut {
    id: u32,
    rect: [f32; 4],
    content: [f32; 4],
    clip: [f32; 4],
    /// Its border box without transforms: what Layout listeners hear.
    layout: [f32; 4],
    /// The scale its transforms and its ancestors' draw it at (1 = none):
    /// `rect` and `content` are already transformed, but sizes inside (text,
    /// borders, editor coordinates) are multiplied by it.
    k: f32,
    /// `rotate`: its box and everything inside it (boxes up to `end` in this list) turn about `pivot`.
    spin: Option<Spin>,
    /// The corner radius of the clip its ancestors put on it (logical px, scaled like `rect`).
    clip_r: f32,
    /// `brightness` and `saturate` on this box and the boxes up to `end` inside it.
    filter: Option<([f32; 4], usize)>,
}

/// A rotation of a subtree: clockwise `angle` (radians) about `pivot` (logical px, in the frame its ancestors'
/// own rotations then turn in), over the boxes from this one to `end` (exclusive).
#[derive(Clone, Copy)]
struct Spin {
    angle: f32,
    pivot: [f32; 2],
    end: usize,
}

/// Turns a quad about a pivot (device px): its centre moves round it and the quad itself turns.
fn spin_quad(q: &mut Quad, sp: &Spin, s: f32) {
    let (sn, cs) = sp.angle.sin_cos();
    let (px, py) = (sp.pivot[0] * s, sp.pivot[1] * s);
    let rot = |x: f32, y: f32| (px + (x - px) * cs - (y - py) * sn, py + (x - px) * sn + (y - py) * cs);
    let (cx, cy) = ((q.rect[0] + q.rect[2]) / 2.0, (q.rect[1] + q.rect[3]) / 2.0);
    let (nx, ny) = rot(cx, cy);
    let (dx, dy) = (nx - cx, ny - cy);
    q.rect = [q.rect[0] + dx, q.rect[1] + dy, q.rect[2] + dx, q.rect[3] + dy];
    if let Some(t) = &mut q.extra.trap {
        *t = [t[0] + dy, t[1] + dy, t[2] + dy]; // a strip's heights are in the quad's own frame
    }
    if let Some(sp) = &mut q.extra.span {
        *sp = sp.map(|x| x + dx); // a row's edges are x positions in it
    }
    q.extra.rotation += sp.angle;
    // The clip stays a rectangle: the box around the turned one (looser than the real shape).
    if q.clip != NO_CLIP {
        let c = q.clip;
        let corners = [rot(c[0], c[1]), rot(c[2], c[1]), rot(c[2], c[3]), rot(c[0], c[3])];
        let xs = corners.map(|p| p.0);
        let ys = corners.map(|p| p.1);
        q.extra.clip_radius = 0.0; // no longer the clip's own shape
        q.clip = [xs.into_iter().fold(f32::INFINITY, f32::min), ys.into_iter().fold(f32::INFINITY, f32::min), xs.into_iter().fold(f32::NEG_INFINITY, f32::max), ys.into_iter().fold(f32::NEG_INFINITY, f32::max)];
    }
}

pub struct Tree {
    taffy: TaffyTree<u32>,
    /// Created with the first text node.
    text: Option<TextEngine>,
    /// Decoded images by source (a path, or a hash of bytes), shared by the nodes that use them.
    image_cache: HashMap<String, std::sync::Weak<mantou_image::Image>>,
    /// The colour glyph atlas as an image, by the atlas's version.
    color_glyphs: Option<(u64, Arc<Pixels>)>,
    nodes: Nodes,
    styles: HashMap<u32, Vec<(Prop, Value)>>,
    root: Option<u32>,
    clear: [f32; 4],
    title: Option<String>,
    viewport_px: (u32, u32),
    scale: f32,
    layout_dirty: bool,
    /// Laid-out boxes in paint order, for the scene and hit-testing.
    boxes: Vec<LaidOut>,
    stats: TreeStats,
    /// The input with the keyboard focus.
    focus: Option<u32>,
    /// The input a press started in, while the button is down.
    drag: Option<u32>,
    /// The Text node whose text is selected (`userSelect`), and its read-only editor: only one at a time.
    tsel: Option<input::TextSel>,
    events: Vec<TreeEvent>,
    /// Outline every box in the scene (MANTOU_DEBUG=layout).
    debug_layout: bool,
    /// macOS key bindings (see `set_mac_keys`).
    mac: bool,
    /// A Layout listener was added since the last layout.
    reports_pending: bool,
    /// Focus scopes on screen, in the order they appeared, with the input to
    /// give the focus back to when each leaves the screen.
    scopes: Vec<(u32, Option<u32>)>,
    /// The focus when the current batch began: where a scope that appears in
    /// it (and takes the focus with an autoFocus input) gives it back.
    focus_at_batch: Option<u32>,
    /// The last input was the keyboard (not the pointer): focus rings show.
    keyboard_mode: bool,
    /// The focus came from the keyboard: the focused view draws its ring.
    focus_visible: bool,
    /// A scroll offset changed: boxes must be placed again (no relayout needed).
    boxes_dirty: bool,
    /// Scrollbar thumbs, placed with the boxes.
    thumbs: Vec<Thumb>,
    thumb_drag: Option<Drag>,
    /// SCROLL_TO and SCROLL_INTO_VIEW requests, applied after the batch's layout.
    requests: Vec<Request>,
    /// Something drawn may have changed since the last scene.
    scene_dirty: bool,
    /// The app asked for a window size, or limits, since they were last taken.
    window_size: Option<[f32; 2]>,
    window_limits: Option<WindowLimits>,
    /// The clock animations run on (ms), and how many nodes are animating.
    now: f64,
    /// The real time at the last `set_time`, and how fast the animation clock runs against it (MOTION).
    real_now: f64,
    anim_speed: f64,
    /// MOTION's reduced motion; INSTANT, and whether the next layout's moves are instant.
    reduced_motion: bool,
    instant: bool,
    instant_layout: bool,
    animating: usize,
    /// Where the pointer is (logical px; None = outside the window), and the nodes under it, outermost first.
    pointer: Option<(f32, f32)>,
    /// FOLLOW_POINTER: the node drawn at the pointer, and the grab point inside it.
    follow: Option<(u32, f32, f32)>,
    /// Html nodes (their documents' requests are collected after layouts).
    html_nodes: HashSet<u32>,
    /// The Html node whose document has the text selection.
    html_sel: Option<u32>,
    hovered: Vec<u32>,
    /// Something placed can use the hovered path (a Hover listener, a cursor, an input, an Html node, spans):
    /// without one, a still pointer isn't hit-tested again each time boxes move (a scroll, an animation).
    hover_matters: bool,
}

/// What WINDOW_LIMITS asked for: sizes in logical px (0 = no limit).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowLimits {
    pub min: [f32; 2],
    pub max: [f32; 2],
    pub resizable: bool,
}

// SAFETY: Taffy 0.15 stores lengths as tagged pointers (`CompactLength`), which
// makes its tree `!Send`. The pointer is only dereferenced for calc() values;
// this crate builds Taffy without the `calc` feature and only ever creates
// length, percent and auto values, whose "pointer" is just tagged f32 bits.
// The tree owns all its data, holds no thread-local or reference-counted state,
// and is only reached through a `Mutex` by the FFI crate.
unsafe impl Send for Tree {}

impl Default for Tree {
    fn default() -> Self {
        Self::new()
    }
}

const MAX_REPORTED_ERRORS: usize = 16;

impl Tree {
    pub fn new() -> Tree {
        let mut taffy = TaffyTree::new();
        // Rounding happens here, to device pixels, not in Taffy: Taffy's
        // rounding leaves stale values for absolutely positioned nodes.
        taffy.disable_rounding();
        Tree {
            taffy,
            text: None,
            image_cache: HashMap::new(),
            color_glyphs: None,
            nodes: Nodes::default(),
            styles: HashMap::new(),
            root: None,
            clear: [0.08, 0.08, 0.1, 1.0],
            title: None,
            viewport_px: (800, 600),
            scale: 1.0,
            layout_dirty: true,
            boxes: Vec::new(),
            stats: TreeStats::default(),
            focus: None,
            drag: None,
            tsel: None,
            events: Vec::new(),
            debug_layout: false,
            mac: cfg!(target_os = "macos"),
            reports_pending: false,
            scopes: Vec::new(),
            focus_at_batch: None,
            keyboard_mode: false,
            focus_visible: false,
            boxes_dirty: false,
            thumbs: Vec::new(),
            thumb_drag: None,
            requests: Vec::new(),
            scene_dirty: true,
            window_size: None,
            window_limits: None,
            now: 0.0,
            real_now: 0.0,
            anim_speed: 1.0,
            reduced_motion: false,
            instant: false,
            instant_layout: false,
            animating: 0,
            pointer: None,
            follow: None,
            html_nodes: HashSet::new(),
            html_sel: None,
            hovered: Vec::new(),
            hover_matters: false,
        }
    }

    pub fn stats(&self) -> TreeStats {
        TreeStats { text_layouts: self.text.as_ref().map_or(0, TextEngine::uncached_layouts), ..self.stats }
    }

    /// Whether something drawn may have changed since the last scene (a
    /// scene of an unchanged tree would be the same, so it needn't be built).
    pub fn scene_stale(&self) -> bool {
        self.scene_dirty
    }

    /// Outlines every box in the scene, for debugging layout.
    pub fn set_debug_layout(&mut self, on: bool) {
        self.debug_layout = on;
        self.scene_dirty = true;
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Takes the window size the app asked for since the last call (logical px).
    pub fn take_window_size(&mut self) -> Option<[f32; 2]> {
        self.window_size.take()
    }

    /// Takes the window limits the app set since the last call.
    pub fn take_window_limits(&mut self) -> Option<WindowLimits> {
        self.window_limits.take()
    }

    /// Takes the title set since the last call, if any.
    pub fn take_title(&mut self) -> Option<String> {
        self.title.take()
    }

    /// Decodes and applies a batch. A malformed batch is rejected whole.
    pub fn apply(&mut self, bytes: &[u8]) -> Result<ApplyReport, DecodeError> {
        let ops = decode(bytes)?;
        self.focus_at_batch = self.focus;
        if !ops.is_empty() {
            self.scene_dirty = true;
        }
        let mut report = ApplyReport { ops: ops.len(), errors: Vec::new() };
        for o in ops {
            if let Err(e) = self.apply_op(o) {
                if report.errors.len() < MAX_REPORTED_ERRORS {
                    report.errors.push(e);
                }
            }
        }
        self.stats.ops += report.ops as u64;
        Ok(report)
    }

    fn node(&mut self, id: u32) -> Result<&mut Node, String> {
        self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))
    }

    fn apply_op(&mut self, o: Op) -> Result<(), String> {
        match o {
            Op::Create { id, kind } => {
                if id == 0 || self.nodes.contains_key(&id) {
                    return Err(format!("CREATE: id {id} is taken or invalid"));
                }
                let mut input = None;
                let taffy = match kind {
                    p::node_kind::VIEW => self.taffy.new_leaf(Style::default()),
                    p::node_kind::TEXT => {
                        self.text.get_or_insert_with(TextEngine::new);
                        self.taffy.new_leaf_with_context(Style::default(), id)
                    }
                    p::node_kind::IMAGE | p::node_kind::HTML => self.taffy.new_leaf_with_context(Style::default(), id),
                    p::node_kind::INPUT => {
                        input = Some(Box::new(Input::new(self.text.get_or_insert_with(TextEngine::new))));
                        self.taffy.new_leaf_with_context(Style::default(), id)
                    }
                    _ => return Err(format!("CREATE: unknown kind {kind}")),
                }
                .map_err(|e| e.to_string())?;
                self.nodes.insert(id, Node {
                    taffy,
                    kind,
                    text: String::new(),
                    parent: None,
                    children: Vec::new(),
                    own: BTreeMap::new(),
                    shared: 0,
                    listen: 0,
                    v: Visual::default(),
                    input,
                    reported: None,
                    scope: 0,
                    access: None,
                    canvas: Vec::new(),
                    scroll: None,
                    image: (kind == p::node_kind::IMAGE).then(Box::default),
                    html: (kind == p::node_kind::HTML).then(Box::default),
                    drawn: RefCell::new(None),
                    anim: None,
                    last_loc: None,
                    placed: false,
                    rich: None,
                    span_of: None,
                    focusable: (0, 0),
                });
                self.restyle(id);
            }
            Op::Insert { parent, child, before } => self.insert(parent, child, before)?,
            Op::Remove { parent, child } => {
                if self.node(child)?.parent != Some(parent) {
                    return Err(format!("REMOVE: {child} is not a child of {parent}"));
                }
                self.detach(child);
            }
            Op::Release { id } => {
                self.node(id)?;
                self.detach(id);
                let node = self.nodes.remove(&id).expect("checked");
                for c in node.children {
                    if let Some(cn) = self.nodes.get_mut(&c) {
                        cn.parent = None;
                    }
                }
                let _ = self.taffy.remove(node.taffy);
                if self.root == Some(id) {
                    self.root = None;
                    self.layout_dirty = true; // detach() does for the others; the root has no parent
                }
                if self.focus == Some(id) {
                    self.focus = None;
                }
                if self.drag == Some(id) {
                    self.drag = None;
                }
                if self.follow.is_some_and(|f| f.0 == id) {
                    self.follow = None;
                }
                self.html_nodes.remove(&id);
                if self.html_sel == Some(id) {
                    self.html_sel = None;
                }
                if self.tsel.as_ref().is_some_and(|t| t.root == id || t.anchor == id || t.editors.contains_key(&id)) {
                    self.tsel = None;
                }
                self.hovered.retain(|&h| h != id); // gone: no event, there's no one to tell
                // A span: its Text sets its runs without it. A Text: its spans are free again.
                if let Some(t) = node.span_of {
                    self.resolve_rich(t);
                }
                for s in node.rich.iter().flat_map(|r| r.runs.iter().flat_map(|(_, c)| c.iter())) {
                    if let Some(n) = self.nodes.get_mut(s)
                        && n.span_of == Some(id)
                    {
                        n.span_of = None;
                    }
                }
                if node.anim.as_ref().is_some_and(|a| a.is_active()) {
                    self.animating = self.animating.saturating_sub(1);
                }
                self.layout_dirty = true;
            }
            Op::Style { id, prop, value } => {
                self.node(id)?.own.insert(prop, value);
                self.restyle(id);
            }
            Op::StyleReset { id, prop } => {
                self.node(id)?.own.remove(&prop);
                self.restyle(id);
            }
            Op::StyleDef { style_id, props } => {
                if style_id == 0 {
                    return Err("STYLE_DEF: style id 0 is reserved".into());
                }
                self.styles.insert(style_id, props);
                let users: Vec<u32> = self.nodes.iter().filter(|(_, n)| n.shared == style_id).map(|(id, _)| *id).collect();
                for id in users {
                    self.restyle(id);
                }
            }
            Op::StyleUse { id, style_id } => {
                if style_id != 0 && !self.styles.contains_key(&style_id) {
                    return Err(format!("STYLE_USE: no style {style_id}"));
                }
                self.node(id)?.shared = style_id;
                self.restyle(id);
            }
            Op::Listen { id, mask } => {
                let node = self.node(id)?;
                let new_layout = mask & event_mask::LAYOUT != 0 && node.listen & event_mask::LAYOUT == 0;
                let new_hover = mask & event_mask::HOVER != 0 && node.listen & event_mask::HOVER == 0;
                node.listen = mask;
                if new_layout {
                    // A new listener hears the current box at the next layout, even if it's unchanged.
                    node.reported = None;
                    self.reports_pending = true;
                }
                if new_hover {
                    self.hover_listener_added(id);
                }
            }
            Op::SetRoot { id } => {
                if id != 0 {
                    self.node(id)?;
                }
                let old = std::mem::replace(&mut self.root, (id != 0).then_some(id));
                if let Some(old) = old.filter(|o| self.nodes.contains_key(o)) {
                    self.restyle(old);
                }
                if id != 0 {
                    self.restyle(id);
                }
                self.layout_dirty = true;
            }
            Op::ClearColor(c) => self.clear = c,
            Op::Title(t) => self.title = Some(t),
            Op::Text { id, text } => {
                let node = self.node(id)?;
                if node.kind != p::node_kind::TEXT {
                    return Err(format!("TEXT: {id} is not a text node"));
                }
                if node.text != text {
                    node.text = text;
                    *node.drawn.get_mut() = None;
                    let t = node.taffy;
                    let _ = self.taffy.mark_dirty(t);
                    self.layout_dirty = true;
                }
            }
            Op::Value { id, rev, text } => {
                let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
                let Some(inp) = node.input.as_mut() else { return Err(format!("VALUE: {id} is not an input")) };
                if rev < inp.rev {
                    return Ok(()); // the app hadn't seen the user's latest edit: theirs wins
                }
                let engine = self.text.as_mut().expect("inputs create the text engine");
                let ed = inp.editor.get_mut();
                if ed.text() != text {
                    if rev == 0 {
                        ed.set_text(engine, &text);
                    } else {
                        ed.replace(engine, &text);
                    }
                    if ed.multiline {
                        let _ = self.taffy.mark_dirty(node.taffy);
                        self.layout_dirty = true;
                    }
                }
            }
            Op::Select { id, anchor, focus } => {
                let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
                let Some(inp) = node.input.as_mut() else { return Err(format!("SELECT: {id} is not an input")) };
                let engine = self.text.as_mut().expect("inputs create the text engine");
                inp.editor.get_mut().select_utf16(engine, anchor as usize, focus as usize);
            }
            Op::Placeholder { id, text } => {
                let Some(inp) = self.node(id)?.input.as_mut() else { return Err(format!("PLACEHOLDER: {id} is not an input")) };
                inp.placeholder = text;
            }
            Op::InputAllow { id, allow } => {
                let Some(inp) = self.node(id)?.input.as_mut() else { return Err(format!("INPUT_ALLOW: {id} is not an input")) };
                inp.editor.get_mut().set_allow(&allow);
            }
            Op::InputOptions { id, flags, max_length } => {
                let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
                let Some(inp) = node.input.as_mut() else { return Err(format!("INPUT_OPTIONS: {id} is not an input")) };
                let engine = self.text.as_mut().expect("inputs create the text engine");
                if inp.set_options(engine, flags, max_length) {
                    let _ = self.taffy.mark_dirty(node.taffy);
                    self.layout_dirty = true;
                }
            }
            Op::ScrollTo { id, x, y, flags } => {
                if self.node(id)?.scroll.is_none() {
                    return Err(format!("SCROLL_TO: {id} is not a scroll view"));
                }
                self.request_scroll_to(id, x, y, flags);
            }
            Op::ScrollIntoView { id, block } => {
                self.node(id)?;
                self.request_into_view(id, block);
            }
            Op::WindowSize { width, height } => self.window_size = Some([width, height]),
            Op::WindowLimits { min, max, flags } => {
                self.window_limits = Some(WindowLimits { min, max, resizable: flags & p::window_flag::NOT_RESIZABLE == 0 });
            }
            Op::ImagePath { id, path } => {
                let read = path.clone();
                self.set_image(id, format!("path:{path}"), move || std::fs::read(&read).map_err(|e| format!("can't read {read}: {e}"))).map_err(|e| format!("IMAGE_PATH: {e}"))?;
            }
            Op::ImageData { id, data } => {
                let key = image::bytes_key(&data);
                self.set_image(id, key, move || Ok(data)).map_err(|e| format!("IMAGE_DATA: {e}"))?;
            }
            Op::Font(data) => {
                let engine = self.text.get_or_insert_with(TextEngine::new);
                if engine.register_font(data).is_empty() {
                    return Err("FONT: no font in the data".into());
                }
                self.fonts_changed();
            }
            Op::FontFamily { family, names } => {
                if family == 0 {
                    return Err("FONT_FAMILY: family id 0 is the default".into());
                }
                self.text.get_or_insert_with(TextEngine::new).set_family(family, &names);
                self.fonts_changed();
            }
            Op::Canvas { id, commands } => {
                if commands.contains(&p::canvas_cmd::TEXT) {
                    self.text.get_or_insert_with(TextEngine::new); // (a false match on a number only makes the engine early)
                }
                self.node(id)?.canvas = commands;
                self.scene_dirty = true;
            }
            Op::Access { id, role, flags, label } => {
                self.node(id)?.access = (role != 0 || flags != 0 || !label.is_empty()).then_some(access::Access { role, flags, label });
            }
            Op::FocusScope { id, flags } => {
                self.node(id)?.scope = flags;
                self.layout_dirty = true; // scopes open and close at layout
            }
            Op::Focus { id } => {
                if id != 0 && !self.can_focus(self.nodes.get(&id).ok_or_else(|| format!("no node {id}"))?) {
                    return Err(format!("FOCUS: {id} is not an input or a focusable view"));
                }
                self.set_focus((id != 0).then_some(id));
                // As browsers do for focus(): a ring if the user was last using the keyboard.
                self.focus_visible = self.keyboard_mode;
            }
            Op::Html { id, flags, html } => self.set_html(id, flags, &html).map_err(|e| format!("HTML: {e}"))?,
            Op::HtmlResource { id, url, data } => self.html_resource(id, &url, data).map_err(|e| format!("HTML_RESOURCE: {e}"))?,
            Op::Motion { flags, speed } => self.set_motion(flags & p::motion_flag::REDUCED != 0, speed),
            Op::Instant { on } => self.set_instant(on != 0),
            Op::FollowPointer { id, x, y } => {
                if id != 0 {
                    self.node(id)?;
                }
                let (x, y) = (if x.is_finite() { x } else { 0.0 }, if y.is_finite() { y } else { 0.0 });
                self.follow = (id != 0).then_some((id, x, y));
                self.boxes_dirty = true;
            }
            Op::Focusable { id, flags, order } => {
                self.node(id)?.focusable = (flags, order);
                if flags == 0 && self.focus == Some(id) {
                    self.set_focus(None);
                }
            }
            Op::Transition { id, prop, duration, easing } => self.set_transition(id, prop, duration, easing)?,
            Op::TextRuns { id, runs } => self.set_runs(id, runs)?,
            Op::Keyframes { id, animation, values } => self.set_keyframes(id, animation, values)?,
            Op::Animate { id, animation, prop, from, to, duration, easing, iterations, flags } => {
                self.start_animation(id, animation, prop, from, to, duration, easing, iterations, flags)?
            }
            Op::Unknown { .. } => {}
        }
        Ok(())
    }

    fn insert(&mut self, parent: u32, child: u32, before: u32) -> Result<(), String> {
        if parent == child {
            return Err("INSERT: a node cannot contain itself".into());
        }
        self.node(child)?;
        if matches!(self.node(parent)?.kind, p::node_kind::TEXT | p::node_kind::INPUT | p::node_kind::IMAGE | p::node_kind::HTML) {
            return Err(format!("INSERT: {parent} is a text, input or image node, which have no children"));
        }
        // No cycles: the child must not be an ancestor of the parent.
        let mut a = Some(parent);
        while let Some(x) = a {
            if x == child {
                return Err(format!("INSERT: {child} is an ancestor of {parent}"));
            }
            a = self.nodes[&x].parent;
        }
        if before != 0 && self.nodes.get(&before).and_then(|b| b.parent) != Some(parent) {
            return Err(format!("INSERT: {before} is not a child of {parent}"));
        }
        // A node already in place is left alone (design §5.2 invariant 5).
        if self.nodes[&child].parent == Some(parent) {
            let siblings = &self.nodes[&parent].children;
            let i = siblings.iter().position(|&c| c == child).expect("listed");
            let next = siblings.get(i + 1).copied().unwrap_or(0);
            if next == before || before == child {
                return Ok(());
            }
        }
        self.detach(child);
        let siblings = &self.nodes[&parent].children;
        let at = if before == 0 { siblings.len() } else { siblings.iter().position(|&c| c == before).expect("checked") };
        let (pt, ct) = (self.nodes[&parent].taffy, self.nodes[&child].taffy);
        self.taffy.insert_child_at_index(pt, at, ct).map_err(|e| e.to_string())?;
        self.nodes.get_mut(&parent).expect("checked").children.insert(at, child);
        self.nodes.get_mut(&child).expect("checked").parent = Some(parent);
        self.layout_dirty = true;
        Ok(())
    }

    fn detach(&mut self, child: u32) {
        let Some(parent) = self.nodes.get(&child).and_then(|n| n.parent) else { return };
        let ct = self.nodes[&child].taffy;
        if let Some(pn) = self.nodes.get_mut(&parent) {
            pn.children.retain(|&c| c != child);
            let _ = self.taffy.remove_child(pn.taffy, ct);
        }
        self.nodes.get_mut(&child).expect("exists").parent = None;
        self.layout_dirty = true;
    }

    /// Rebuilds a node's Taffy style and visual properties from defaults, its
    /// shared style, then its own properties.
    fn restyle(&mut self, id: u32) {
        let is_root = self.root == Some(id);
        let (vw, vh) = self.viewport_logical();
        let Some(node) = self.nodes.get(&id) else { return };
        // The schema's defaults, where they differ from Taffy's: a column, and
        // `position: relative`, so every view is a containing block for its
        // absolutely positioned children (Taffy defaults to `static`, whose
        // boxes aren't; dunkbing/mantou#1).
        let mut style = Style { flex_direction: FlexDirection::Column, position: Position::Relative, ..Style::default() };
        let mut v = Visual { opacity: 1.0, scale: 1.0, brightness: 1.0, saturate: 1.0, contrast: 1.0, color: 0xff_00_00_00, text: TextStyle::default(), ..Visual::default() };
        let shared = self.styles.get(&node.shared).map(|v| v.as_slice()).unwrap_or(&[]);
        for (prop, value) in shared.iter().copied().chain(node.own.iter().map(|(k, v)| (*k, *v))) {
            set_prop(&mut style, &mut v, prop, value);
        }
        if is_root {
            // The root fills the window, whatever it asked for.
            style.size = Size { width: Dimension::length(vw), height: Dimension::length(vh) };
            style.position = Position::Relative;
        }
        v.hidden = style.display == Display::None;
        let taffy = node.taffy;
        // Only what changed costs anything: a new layout style lays out again (Taffy marks the node and its
        // ancestors), a new text style measures the node again, and the rest (colours, opacity, transforms…)
        // only places the boxes again and draws.
        let layout_changed = self.taffy.style(taffy).map_or(true, |old| *old != style);
        if layout_changed {
            let _ = self.taffy.set_style(taffy, style);
        }
        let node = self.nodes.get_mut(&id).expect("exists");
        let text_changed = node.v.text != v.text;
        if text_changed {
            if let (Some(inp), Some(engine)) = (node.input.as_mut(), self.text.as_ref()) {
                inp.editor.get_mut().set_style(engine, &v.text);
            }
            *node.drawn.get_mut() = None;
            let _ = self.taffy.mark_dirty(taffy);
        }
        if v.scrolls != node.scroll.is_some() {
            node.scroll = v.scrolls.then(ScrollState::default);
        }
        let (before, drawn_before) = (node.v, node.vis());
        node.v = v;
        let (rich, span_of) = (node.rich.is_some(), node.span_of);
        if layout_changed || text_changed {
            self.layout_dirty = true;
        } else {
            self.boxes_dirty = true;
        }
        self.start_transitions(id, before, drawn_before);
        // A Text's spans build on its style; a span's style changes its Text's runs.
        if rich {
            self.resolve_rich(id);
        }
        if let Some(t) = span_of {
            self.resolve_rich(t);
        }
    }

    fn viewport_logical(&self) -> (f32, f32) {
        (self.viewport_px.0 as f32 / self.scale, self.viewport_px.1 as f32 / self.scale)
    }

    /// Sets the window's physical size and scale factor.
    pub fn set_viewport(&mut self, width_px: u32, height_px: u32, scale: f32) {
        let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
        if self.viewport_px == (width_px, height_px) && self.scale == scale {
            return;
        }
        self.viewport_px = (width_px, height_px);
        self.scale = scale;
        self.scene_dirty = true;
        if let Some(root) = self.root {
            self.restyle(root);
        }
        self.layout_dirty = true;
    }

    /// Lays out the tree if anything changed since the last layout.
    pub fn layout(&mut self) -> bool {
        if !self.layout_dirty {
            // Scrolling moves boxes without a relayout.
            if self.boxes_dirty || !self.requests.is_empty() {
                self.place();
            } else if self.reports_pending {
                self.report_layouts();
            }
            return false;
        }
        self.layout_dirty = false;
        let Some(root) = self.root else {
            // No root (the app's was released): nothing is placed, scroll thumbs included.
            self.boxes.clear();
            self.thumbs.clear();
            self.update_hover();
            return true;
        };
        let (vw, vh) = self.viewport_logical();
        let rt = self.nodes[&root].taffy;
        let space = Size { width: AvailableSpace::Definite(vw), height: AvailableSpace::Definite(vh) };
        let (nodes, styles, mut text, scale) = (&self.nodes, &self.styles, self.text.as_mut(), self.scale);
        let measured = self.taffy.compute_layout_with_measure(rt, space, |inputs, _, ctx, style| {
            taffy::compute_leaf_layout(inputs, style, |_, _| 0.0, |known, avail| {
                let Some(node) = ctx.and_then(|id| nodes.get(id)) else { return Size::ZERO };
                if let Some(h) = &node.html {
                    // As wide as it's given (600 px when it may pick), as tall as its document is then.
                    let width = known.width.or(match avail.width {
                        AvailableSpace::Definite(w) => Some(w),
                        AvailableSpace::MinContent => Some(320.0),
                        AvailableSpace::MaxContent => None,
                    });
                    let (w, h) = h.measure(width, scale);
                    return Size { width: known.width.unwrap_or(w), height: known.height.unwrap_or(h.ceil()) };
                }
                if let Some(img) = &node.image {
                    let (w, h) = image::measure(img.source.as_ref().map(|s| s.natural_size()), (known.width, known.height));
                    return Size { width: w, height: h };
                }
                let Some(text) = text.as_deref_mut() else { return Size::ZERO };
                if let Some(inp) = &node.input {
                    // Like a browser's: a fixed width, unless the layout gives one (and no
                    // minimum, so it can shrink); one line tall, or as tall as the text.
                    let width = known.width.unwrap_or(match avail.width {
                        AvailableSpace::MinContent => 0.0,
                        _ => input::DEFAULT_WIDTH,
                    });
                    // Its height is its text's at the width it will have: when a column stretches it, that's the
                    // column's (not the default width), so the text is wrapped once, where it will show.
                    let wrap = known.width.or_else(|| stretched_width(nodes, styles, node, style, avail.width)).unwrap_or(width);
                    let height = known.height.unwrap_or_else(|| inp.editor.borrow_mut().measure_height(text, wrap).ceil());
                    return Size { width, height };
                }
                let width = known.width.or(match avail.width {
                    AvailableSpace::Definite(w) => Some(w),
                    AvailableSpace::MinContent => Some(0.0),
                    AvailableSpace::MaxContent => None,
                });
                let l = text.layout_rich(&node.text, &node.v.text, node.spans(), width);
                // Rounded up, so laying the text out again at exactly this width wraps the same.
                Size { width: known.width.unwrap_or(l.width.ceil()), height: known.height.unwrap_or(l.height.ceil()) }
            })
        });
        if measured.is_ok() {
            self.stats.layouts += 1;
            self.animate_layout();
        }
        self.place();
        self.html_requests();
        true
    }

    /// Places the boxes from the last layout and scroll offsets, applies the
    /// app's scroll requests, and queues what listeners asked to hear.
    fn place(&mut self) {
        self.scene_dirty = true;
        self.place_boxes();
        self.apply_requests();
        for b in &self.boxes {
            if let Some(inp) = &self.nodes[&b.id].input {
                let c = b.content;
                inp.editor.borrow_mut().set_size((c[2] - c[0]) / b.k, (c[3] - c[1]) / b.k);
            }
        }
        self.report_layouts();
        self.report_scrolls();
        self.update_scopes();
        self.update_hover();
    }

    fn place_boxes(&mut self) {
        self.boxes_dirty = false;
        self.hover_matters = false;
        self.boxes.clear();
        self.thumbs.clear();
        if let Some(root) = self.root {
            let (vw, vh) = self.viewport_logical();
            self.collect_boxes(root, 0.0, 0.0, [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY], 0.0, Xf { k: 1.0, o: [0.0; 2] }, None, [0.0, 0.0, vw, vh]);
        }
    }

    /// Queues a Layout event for each listening node whose box changed since
    /// it was last reported. A node that isn't laid out (detached, hidden)
    /// reports nothing, and is reported again once it is.
    fn report_layouts(&mut self) {
        self.reports_pending = false;
        let mut laid_out = std::collections::HashSet::new();
        for b in &self.boxes {
            let node = self.nodes.get_mut(&b.id).expect("laid-out nodes exist");
            if node.listen & event_mask::LAYOUT == 0 {
                continue;
            }
            laid_out.insert(b.id);
            let r = b.layout;
            let rect = [r[0], r[1], r[2] - r[0], r[3] - r[1]];
            if node.reported != Some(rect) {
                node.reported = Some(rect);
                self.events.push(TreeEvent::Layout { id: b.id, rect });
            }
        }
        for (id, node) in self.nodes.iter_mut() {
            if node.listen & event_mask::LAYOUT != 0 && !laid_out.contains(id) {
                node.reported = None;
            }
        }
    }

    /// Fonts or font families changed: every text and input is measured and drawn again.
    fn fonts_changed(&mut self) {
        let Some(engine) = self.text.as_ref() else { return };
        for node in self.nodes.values_mut() {
            if node.kind == p::node_kind::TEXT || node.input.is_some() {
                *node.drawn.get_mut() = None;
                if let Some(inp) = node.input.as_mut() {
                    inp.editor.get_mut().fonts_changed(engine);
                }
                let _ = self.taffy.mark_dirty(node.taffy);
            }
        }
        self.layout_dirty = true;
    }

    /// Events for JS since the last call.
    pub fn take_events(&mut self) -> Vec<TreeEvent> {
        // Only the focused input's selection moves by itself; say so when it listens.
        if let Some(id) = self.focus
            && let Some(node) = self.nodes.get_mut(&id)
            && node.listen & event_mask::SELECT != 0
            && let Some(inp) = node.input.as_mut()
        {
            let (a, f) = inp.editor.get_mut().selection_utf16();
            if inp.reported_sel != Some((a, f)) {
                inp.reported_sel = Some((a, f));
                self.events.push(TreeEvent::Select { id, anchor: a as u32, focus: f as u32 });
            }
        }
        std::mem::take(&mut self.events)
    }

    /// Places a node and its subtree. `px, py` is its parent's origin in
    /// layout coordinates (scroll offsets applied); `xf` maps layout
    /// coordinates to the window's, with the ancestors' transforms.
    /// `view`: the nearest scroll view's box and `pbox` the parent's content area, both in layout coordinates
    /// (for sticky nodes).
    #[allow(clippy::too_many_arguments)]
    fn collect_boxes(&mut self, id: u32, px: f32, py: f32, clip: [f32; 4], clip_r: f32, xf: Xf, view: Option<[f32; 4]>, pbox: [f32; 4]) {
        let node = &self.nodes[&id];
        if node.v.hidden {
            return;
        }
        let Ok(l) = self.taffy.layout(node.taffy) else { return };
        let (mut x, mut y) = (px + l.location.x, py + l.location.y);
        let (mut clip, mut xf, mut clip_r) = (clip, xf, clip_r);
        let [it, ir, ib, il] = node.v.inset;
        let followed = self.follow.filter(|f| f.0 == id).zip(self.pointer);
        match node.v.position {
            _ if followed.is_some() => {
                // FOLLOW_POINTER: against the window, at the pointer minus the grab point.
                let ((_, gx, gy), (px, py)) = followed.expect("checked");
                (x, y) = (px - gx, py - gy);
                clip = [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY];
                clip_r = 0.0;
                xf = Xf { k: 1.0, o: [0.0; 2] };
            }
            2 => {
                // Fixed: against the window, whatever the ancestors scroll, clip or transform.
                let (vw, vh) = self.viewport_logical();
                x = il.or(ir.map(|r| vw - r - l.size.width)).unwrap_or(x);
                y = it.or(ib.map(|b| vh - b - l.size.height)).unwrap_or(y);
                clip = [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY];
                clip_r = 0.0;
                xf = Xf { k: 1.0, o: [0.0; 2] };
            }
            3 => {
                // Sticky: taffy moved it by its insets as for a relative node; undo that, then keep it
                // within `view` at the distances given, and inside its parent.
                x += if il.is_some() { -il.unwrap_or(0.0) } else { ir.unwrap_or(0.0) };
                y += if it.is_some() { -it.unwrap_or(0.0) } else { ib.unwrap_or(0.0) };
                let vw = view.unwrap_or_else(|| {
                    let (w, h) = self.viewport_logical();
                    [0.0, 0.0, w, h]
                });
                let stick = |pos: f32, size: f32, lo: Option<f32>, hi: Option<f32>, v: (f32, f32), p: (f32, f32)| {
                    let mut pos = pos;
                    if let Some(lo) = lo {
                        pos = pos.max(v.0 + lo);
                    }
                    if let Some(hi) = hi {
                        pos = pos.min(v.1 - hi - size);
                    }
                    pos.min(p.1 - size).max(p.0)
                };
                x = stick(x, l.size.width, il, ir, (vw[0], vw[2]), (pbox[0], pbox[2]));
                y = stick(y, l.size.height, it, ib, (vw[1], vw[3]), (pbox[1], pbox[3]));
            }
            _ => {}
        }
        let rect = [x, y, x + l.size.width, y + l.size.height];
        let (pd, bd) = (l.padding, l.border);
        let content = [x + pd.left + bd.left, y + pd.top + bd.top, rect[2] - pd.right - bd.right, rect[3] - pd.bottom - bd.bottom];
        // Its own transform, about its centre, then its ancestors'.
        let v = node.vis();
        let xf = if v.scale != 1.0 || v.translate != [0.0; 2] {
            let (s, c) = (v.scale, [(rect[0] + rect[2]) / 2.0, (rect[1] + rect[3]) / 2.0]);
            Xf { k: xf.k * s, o: [(c[0] * (1.0 - s) + v.translate[0]) * xf.k + xf.o[0], (c[1] * (1.0 - s) + v.translate[1]) * xf.k + xf.o[1]] }
        } else {
            xf
        };
        let mut laid = LaidOut { id, rect: xf.rect(rect), content: xf.rect(content), clip, layout: rect, k: xf.k, spin: None, clip_r, filter: None };
        if [v.brightness, v.saturate, v.contrast, v.invert] != NO_FILTER {
            laid.filter = Some(([v.brightness, v.saturate, v.contrast, v.invert], 0));
        }
        if v.rotate % 360.0 != 0.0 {
            laid.spin = Some(Spin { angle: v.rotate.to_radians(), pivot: [(laid.rect[0] + laid.rect[2]) / 2.0, (laid.rect[1] + laid.rect[3]) / 2.0], end: 0 });
        }
        let at_box = self.boxes.len();
        self.boxes.push(laid);
        let node = self.nodes.get_mut(&id).expect("exists");
        node.placed = true;
        self.hover_matters |= node.listen & event_mask::HOVER != 0 || node.v.cursor != p::cursor::AUTO || node.input.is_some() || node.html.is_some() || node.rich.is_some();
        let node = &self.nodes[&id];
        let inner = if node.v.clips { intersect(clip, laid.rect) } else { clip };
        // A clip with rounded corners clips to them; one that doesn't shrink the clip leaves the one above in charge.
        let inner_r = if node.v.clips && inner != clip { v.radius * xf.k } else { clip_r };
        let border = [bd.left, bd.top, bd.right, bd.bottom];
        // A scroll view: how far its content reaches (from its padding box), and so how far it scrolls.
        let mut extent = [0.0f32; 2];
        if node.scroll.is_some() {
            for &c in &node.children {
                let cn = &self.nodes[&c];
                let Ok(cl) = self.taffy.layout(cn.taffy) else { continue };
                if cn.v.hidden {
                    continue;
                }
                extent[0] = extent[0].max(cl.location.x + cl.size.width + cl.margin.right - bd.left + pd.right);
                extent[1] = extent[1].max(cl.location.y + cl.size.height + cl.margin.bottom - bd.top + pd.bottom);
            }
            let view = [rect[0] + border[0], rect[1] + border[1], rect[2] - border[2], rect[3] - border[3]];
            let st = self.nodes.get_mut(&id).and_then(|n| n.scroll.as_mut()).expect("a scroll view");
            st.max = [(extent[0] - (view[2] - view[0])).max(0.0), (extent[1] - (view[3] - view[1])).max(0.0)];
            st.offset = [st.offset[0].clamp(0.0, st.max[0]), st.offset[1].clamp(0.0, st.max[1])];
        }
        let node = &self.nodes[&id];
        let offset = node.scroll.map_or([0.0; 2], |s| s.offset);
        let (child_view, child_box) = if node.scroll.is_some() {
            let v = [rect[0] + border[0], rect[1] + border[1], rect[2] - border[2], rect[3] - border[3]];
            (Some(v), [x - offset[0], y - offset[1], x - offset[0] + extent[0].max(rect[2] - rect[0]), y - offset[1] + extent[1].max(rect[3] - rect[1])])
        } else {
            (view, rect)
        };
        if node.children.iter().any(|c| self.nodes[c].v.z != 0) {
            let mut kids = node.children.clone();
            kids.sort_by_key(|c| self.nodes[c].v.z); // stable: ties keep tree order
            for c in kids {
                self.collect_boxes(c, x - offset[0], y - offset[1], inner, inner_r, xf, child_view, child_box);
            }
        } else {
            // In tree order, without copying the list (a child's subtree never changes it).
            for i in 0..node.children.len() {
                let c = self.nodes[&id].children[i];
                self.collect_boxes(c, x - offset[0], y - offset[1], inner, inner_r, xf, child_view, child_box);
            }
        }
        let end = self.boxes.len();
        if let Some(sp) = &mut self.boxes[at_box].spin {
            sp.end = end;
        }
        if let Some(f) = &mut self.boxes[at_box].filter {
            f.1 = end;
        }
        let node = &self.nodes[&id];
        if let Some(st) = node.scroll
            && !node.v.no_scrollbar
        {
            let at = self.boxes.len();
            let mut t = scroll::thumbs(id, &laid, border.map(|b| b * xf.k), &st, extent.map(|e| e * xf.k), at);
            for th in &mut t {
                th.clip = intersect(clip, laid.rect);
            }
            self.thumbs.extend(t);
        }
    }

    /// Every placed box as it's drawn now, one per line in paint order, for tools that look at the screen
    /// (tests, agents): `id x0 y0 x1 y1 vx0 vy0 vx1 vy1 opacity animating`, logical px. The first rect is
    /// the box with its transforms; the second what of it shows inside its ancestors' clips (empty when
    /// nothing does); opacity is its own times its ancestors'; animating is 1 while an animation moves or
    /// fades it or an ancestor.
    pub fn presented(&self) -> String {
        use std::fmt::Write;
        let mut out = String::new();
        let mut state: rustc_hash::FxHashMap<u32, (f32, bool)> = Default::default();
        for b in &self.boxes {
            let Some(node) = self.nodes.get(&b.id) else { continue };
            let (pa, pm) = node.parent.and_then(|p| state.get(&p).copied()).unwrap_or((1.0, false));
            let alpha = pa * node.vis().opacity;
            let moving = pm || node.anim.as_ref().is_some_and(|a| a.is_active());
            state.insert(b.id, (alpha, moving));
            let r = b.rect;
            let v = intersect(r, b.clip);
            let v = if v[2] > v[0] && v[3] > v[1] { v } else { [0.0; 4] };
            let _ = writeln!(out, "{} {} {} {} {} {} {} {} {} {} {}", b.id, r[0], r[1], r[2], r[3], v[0], v[1], v[2], v[3], alpha, moving as u8);
        }
        out
    }

    /// The node's box in logical pixels, after the last layout.
    pub fn rect(&self, id: u32) -> Option<[f32; 4]> {
        self.boxes.iter().find(|b| b.id == id).map(|b| b.rect)
    }

    /// Builds the scene from the last layout (call `layout` first). Text is
    /// laid out at its final width and its glyphs rasterized into the atlas.
    pub fn scene(&mut self) -> Scene {
        self.scene_dirty = false;
        self.stats.scenes += 1;
        let s = self.scale;
        let snap = |v: f32| (v * s).round();
        let mut quads: Vec<Quad> = Vec::new();
        let rgba = |c: u32, alpha: f32| {
            let ch = |shift: u32| ((c >> shift) & 255) as f32 / 255.0;
            [ch(0), ch(8), ch(16), ch(24) * alpha]
        };
        let mut glyphs = false;
        let mut images: HashMap<u32, Arc<Pixels>> = HashMap::new();
        let mut alphas: rustc_hash::FxHashMap<u32, f32> = Default::default();
        let thumb_quad = |t: &Thumb, nodes: &Nodes| {
            let v = nodes[&t.view].vis();
            let mut alpha = v.opacity;
            let mut a = nodes[&t.view].parent;
            while let Some(pid) = a {
                alpha *= nodes[&pid].vis().opacity;
                a = nodes[&pid].parent;
            }
            let c = t.clip;
            let clip = if c[0].is_finite() { [snap(c[0]), snap(c[1]), snap(c[2]), snap(c[3])] } else { NO_CLIP };
            let r = t.rect;
            Quad {
                rect: [snap(r[0]), snap(r[1]), snap(r[2]), snap(r[3])],
                color: rgba(v.scrollbar_color.unwrap_or(0x8c80_8080), alpha),
                uv: [0.0; 4],
                clip,
                radius: scroll::THUMB_RADIUS * s,
                border: 0.0,
                border_color: [0.0; 4],
                shadow: None,
                image: None,
                extra: Extra::NONE,
            }
        };
        let mut thumbs = self.thumbs.iter().peekable();
        // `rotate`: the quads a box makes are turned by every spin around it, innermost first.
        let mut spins: Vec<Spin> = Vec::new();
        let mut filters: Vec<([f32; 4], usize)> = Vec::new();
        let mut from = 0;
        let mut clip_r = 0.0;
        for (i, b) in self.boxes.iter().enumerate() {
            for q in &mut quads[from..] {
                q.extra.clip_radius = clip_r * s;
                for sp in spins.iter().rev() {
                    spin_quad(q, sp, s);
                }
                for f in &filters {
                    q.extra.filter = both(q.extra.filter, f.0);
                }
            }
            while spins.last().is_some_and(|sp| sp.end <= i) {
                spins.pop();
            }
            while filters.last().is_some_and(|f| f.1 <= i) {
                filters.pop();
            }
            spins.extend(b.spin);
            filters.extend(b.filter);
            clip_r = b.clip_r;
            // A scroll view's thumb goes over its content, before whatever comes after it.
            while let Some(t) = thumbs.next_if(|t| t.at <= i) {
                quads.push(thumb_quad(t, &self.nodes));
            }
            from = quads.len();
            let node = &self.nodes[&b.id];
            // What's drawn now: the style, with animated values over it.
            let v = node.vis();
            let k = b.k;
            // Its opacity times its ancestors': boxes come after their parent's, so the parent's is known.
            let parent_alpha = node.parent.map_or(1.0, |p| {
                alphas.get(&p).copied().unwrap_or_else(|| {
                    let (mut alpha, mut a) = (1.0, Some(p));
                    while let Some(pid) = a {
                        let pn = &self.nodes[&pid];
                        alpha *= pn.vis().opacity;
                        a = pn.parent;
                    }
                    alpha
                })
            });
            let alpha = v.opacity * parent_alpha;
            alphas.insert(b.id, alpha);
            let clip = if b.clip[0].is_finite() { [snap(b.clip[0]), snap(b.clip[1]), snap(b.clip[2]), snap(b.clip[3])] } else { NO_CLIP };
            if clip[2] <= clip[0] || clip[3] <= clip[1] {
                continue; // clipped away entirely
            }
            let r = b.rect;
            let bg = rgba(v.background, alpha);
            let sides_set = v.side_colors.iter().any(|c| *c != 0);
            let common = rgba(v.border_color, alpha);
            // The top side's colour is the quad's; the others go beside it when they differ.
            let side = |i: usize| if v.side_colors[i] != 0 { rgba(v.side_colors[i], alpha) } else { common };
            let border_color = side(0);
            let side_colors = sides_set.then(|| [side(1), side(2), side(3)]);
            let any_border = border_color[3] > 0.0 || side_colors.is_some_and(|c| c.iter().any(|c| c[3] > 0.0));
            let border = if any_border { (v.border * k * s).max(0.0) } else { 0.0 };
            let rect = [snap(r[0]), snap(r[1]), snap(r[2]), snap(r[3])];
            let sc = rgba(v.shadow_color, alpha);
            if sc[3] > 0.0 && r[2] > r[0] && r[3] > r[1] {
                // Under the box: its shape moved by the offset and grown by the spread.
                let [sx, sy, blur, spread] = v.shadow.map(|x| x * k);
                let shape = [(r[0] + sx - spread) * s, (r[1] + sy - spread) * s, (r[2] + sx + spread) * s, (r[3] + sy + spread) * s];
                let sigma = blur.max(0.0) * s / 2.0;
                let reach = [shape[0] - 3.0 * sigma, shape[1] - 3.0 * sigma, shape[2] + 3.0 * sigma, shape[3] + 3.0 * sigma];
                if shape[2] > shape[0] && shape[3] > shape[1] && overlaps(reach, clip) {
                    let radius = ((v.radius * k + spread) * s).max(0.0);
                    quads.push(Quad { rect: shape, color: sc, uv: [0.0; 4], clip, radius, border: 0.0, border_color: [0.0; 4], shadow: Some(sigma), image: None, extra: Extra::NONE });
                }
            }
            // Corners and sides of their own; a gradient to its end colour.
            let radii = v.radii_p1.map(|r| if r > 0.0 { (r - 1.0) * k * s } else { -1.0 });
            let widths = v.widths_p1.map(|w| if w > 0.0 { (w - 1.0) * k * s } else { -1.0 });
            let widths = if any_border { widths } else { [0.0; 4].map(|_| -1.0) };
            let own_sides = widths.iter().any(|w| *w >= 0.0);
            // Any end colour but plain `transparent` (all zero) makes a gradient, so a fade to a see-through colour works.
            let gradient = (v.gradient != 0).then(|| Gradient {
                end: rgba(v.gradient, alpha),
                angle: (v.gradient_angle + 180.0).to_radians(),
                mid: (v.gradient_mid != 0).then(|| (rgba(v.gradient_mid, alpha), (v.gradient_mid_at + 0.5).clamp(0.0, 1.0))),
                radial: v.gradient_radial,
            });
            let extra = Extra { radii, widths, gradient, side_colors, ..Extra::NONE };
            if (bg[3] > 0.0 || gradient.is_some() || border > 0.0 || (own_sides && widths.iter().any(|w| *w > 0.0))) && rect[2] > rect[0] && rect[3] > rect[1] && overlaps(rect, clip) {
                quads.push(Quad { rect, color: bg, uv: [0.0; 4], clip, radius: v.radius * k * s, border, border_color, shadow: None, image: None, extra });
            }
            // The focus ring: over the box, `offset` outside it, when the focus came from the keyboard.
            if self.focus == Some(b.id) && self.focus_visible && node.input.is_none() {
                let ring = rgba(v.focus_ring_color.unwrap_or(0xfff6823b), alpha);
                let off = v.focus_ring_offset.unwrap_or(2.0) * k;
                let (w, rr) = (2.0 * k, [r[0] - off - 2.0 * k, r[1] - off - 2.0 * k, r[2] + off + 2.0 * k, r[3] + off + 2.0 * k]);
                let rect = [snap(rr[0]), snap(rr[1]), snap(rr[2]), snap(rr[3])];
                if ring[3] > 0.0 && overlaps(rect, clip) {
                    let radius = ((v.radius * k + off + w) * s).max(0.0);
                    quads.push(Quad { rect, color: [0.0; 4], uv: [0.0; 4], clip, radius, border: (w * s).round().max(1.0), border_color: ring, shadow: None, image: None, extra: Extra::NONE });
                }
            }
            if !node.canvas.is_empty() {
                let c = b.content;
                let area = intersect(clip, [snap(c[0]), snap(c[1]), snap(c[2]), snap(c[3])]);
                if area[2] > area[0] && area[3] > area[1] {
                    canvas_quads(&node.canvas, (c[0], c[1]), k, s, |col| rgba(col, alpha), area, &mut quads, self.text.as_mut(), &v.text, &mut glyphs);
                }
            }
            #[cfg(feature = "html")]
            if let Some(h) = node.html.as_ref() {
                let (vw, vh) = self.viewport_logical();
                let visible = intersect(intersect(b.clip, [0.0, 0.0, vw, vh]), b.content);
                for (band, px) in h.bands(b.content, visible, k, s) {
                    let rect = [snap(band[0]), snap(band[1]), snap(band[2]), snap(band[3])];
                    let uv = [0.0, 0.0, px.width as f32, px.height as f32];
                    quads.push(Quad { rect, color: [1.0, 1.0, 1.0, alpha], uv, clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: Some(ImageRef { id: px.id, tint: false }), extra: Extra::NONE });
                    images.insert(px.id, px);
                }
                // The selection, over the text: a translucent blue that tints it.
                let tint = rgba(SELECTION, alpha);
                for r in h.selection(b.content, k) {
                    let rect = intersect(visible, r);
                    let rect = [snap(rect[0]), snap(rect[1]), snap(rect[2]), snap(rect[3])];
                    if rect[2] > rect[0] && rect[3] > rect[1] && overlaps(rect, clip) {
                        quads.push(Quad { rect, color: tint, uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None, extra: Extra::NONE });
                    }
                }
            }
            if let Some(src) = node.image.as_ref().and_then(|i| i.source.as_ref()) {
                let (rect_l, frac) = image::place(node.v.fit, b.content, src.natural_size());
                let rect = [snap(rect_l[0]), snap(rect_l[1]), snap(rect_l[2]), snap(rect_l[3])];
                if rect[2] > rect[0] && rect[3] > rect[1] && overlaps(rect, clip) {
                    // An SVG is rasterized at the size its whole image is drawn at (bigger than the box for cover).
                    let full = ((rect[2] - rect[0]) / (frac[2] - frac[0]), (rect[3] - rect[1]) / (frac[3] - frac[1]));
                    let slot = &node.image.as_ref().expect("an image").drawn;
                    let mut drawn = slot.borrow_mut();
                    let reuse = drawn.as_ref().filter(|p| !src.is_svg() || (p.width, p.height) == (full.0.round() as u32, full.1.round() as u32)).cloned();
                    let pixels = reuse.or_else(|| src.pixels(full.0.round() as u32, full.1.round() as u32));
                    *drawn = pixels.clone();
                    if let Some(px) = pixels {
                        let (pw, ph) = (px.width as f32, px.height as f32);
                        let uv = [frac[0] * pw, frac[1] * ph, frac[2] * pw, frac[3] * ph];
                        let tint = v.color_set;
                        let color = if tint { rgba(v.color, alpha) } else { [1.0, 1.0, 1.0, alpha] };
                        quads.push(Quad { rect, color, uv, clip, radius: v.radius * k * s, border: 0.0, border_color: [0.0; 4], shadow: None, image: Some(ImageRef { id: px.id, tint }), extra: Extra::NONE });
                        images.insert(px.id, px);
                    }
                }
            }
            if node.kind == p::node_kind::TEXT && !node.text.is_empty() {
                let color = rgba(v.color, alpha);
                if color[3] <= 0.0 && node.rich.is_none() {
                    continue;
                }
                let c = b.content;
                // Entirely clipped away: not laid out at all. (A font size of
                // slack covers glyphs that reach past the box, like italics.)
                let slack = v.text.size * k;
                let reach = [snap(b.rect[0] - slack), snap(b.rect[1] - slack), snap(b.rect[2] + slack), snap(b.rect[3] + slack)];
                if !overlaps(reach, clip) {
                    continue;
                }
                let Some(text) = self.text.as_mut() else { continue };
                let width = ((c[2] - c[0]) / k).max(0.0);
                let mut drawn = node.drawn.borrow_mut();
                let layout = match drawn.as_ref() {
                    Some((w, l)) if *w == width.to_bits() => l.clone(),
                    _ => {
                        let l = text.layout_rich(&node.text, &node.v.text, node.spans(), Some(width));
                        *drawn = Some((width.to_bits(), l.clone()));
                        l
                    }
                };
                if let Some(ed) = self.tsel.as_mut().and_then(|t| t.editors.get_mut(&b.id)) {
                    input::sync_selection(ed, text, node, c, k);
                    let sel = rgba(v.selection_color.unwrap_or(SELECTION), alpha);
                    for r in ed.selection(text) {
                        let rect = [snap(c[0] + r[0] * k), snap(c[1] + r[1] * k), snap(c[0] + r[2] * k), snap(c[1] + r[3] * k)];
                        quads.push(Quad { rect, color: sel, uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None, extra: Extra::NONE });
                    }
                }
                // Colours by span: 0 is the Text's own; spans' highlights go under the glyphs.
                let looks = node.rich.as_ref().map_or(&[][..], |r| &r.looks[..]);
                let colors: Vec<[f32; 4]> = std::iter::once(color).chain(looks.iter().map(|l| rgba(l.color, alpha))).collect();
                // Device px, at least one tall (a hairline underline at any scale).
                let at = |d: &[f32; 4]| [snap(c[0] + d[0] * k), snap(c[1] + d[1] * k), snap(c[0] + d[2] * k), snap(c[1] + d[3] * k).max(snap(c[1] + d[1] * k) + 1.0)];
                for run in layout.runs.iter().filter(|r| r.span > 0) {
                    let bg = looks.get(run.span as usize - 1).map_or(0, |l| l.background);
                    let rect = at(&run.rect);
                    if bg >> 24 != 0 && overlaps(rect, clip) {
                        quads.push(Quad { rect, color: rgba(bg, alpha), uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None, extra: Extra::NONE });
                    }
                }
                glyphs |= push_glyphs(&mut quads, text, &layout.glyphs, (c[0], c[1]), k, s, &colors, clip);
                for d in &layout.decorations {
                    let rect = at(&d.rect);
                    let color = colors.get(d.span as usize).copied().unwrap_or(color);
                    if overlaps(rect, clip) {
                        quads.push(Quad { rect, color, uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None, extra: Extra::NONE });
                    }
                }
            }
            if let (Some(inp), Some(text)) = (&node.input, self.text.as_mut()) {
                let c = b.content;
                let clip = intersect(clip, [snap(c[0]), snap(c[1]), snap(c[2]), snap(c[3])]);
                if clip[2] <= clip[0] || clip[3] <= clip[1] {
                    continue;
                }
                let focused = self.focus == Some(b.id);
                let mut ed = inp.editor.borrow_mut();
                if focused {
                    ed.keep_caret_visible(text);
                }
                let (ox, oy) = input::origin(&ed, text, c, k);
                let color = rgba(v.color, alpha);
                let fill = |r: [f32; 4], color: [f32; 4]| Quad {
                    rect: [snap(ox + r[0] * k), snap(oy + r[1] * k), snap(ox + r[2] * k), snap(oy + r[3] * k)],
                    color,
                    uv: [0.0; 4],
                    clip,
                    radius: 0.0,
                    border: 0.0,
                    border_color: [0.0; 4],
                    shadow: None,
                    image: None,
                    extra: Extra::NONE,
                };
                if ed.text().is_empty() && !ed.is_composing() && !inp.placeholder.is_empty() {
                    let pc = v.placeholder_color.map_or([color[0], color[1], color[2], color[3] * 0.4], |p| rgba(p, alpha));
                    let style = TextStyle { max_lines: if ed.multiline { 0 } else { 1 }, ..v.text };
                    let layout = text.layout(&inp.placeholder, &style, ed.multiline.then_some(((c[2] - c[0]) / k).max(0.0)));
                    glyphs |= push_glyphs(&mut quads, text, &layout.glyphs, (ox, oy), k, s, &[pc], clip);
                }
                if focused {
                    let sel = rgba(v.selection_color.unwrap_or(SELECTION), alpha);
                    quads.extend(ed.selection(text).into_iter().map(|r| fill(r, sel)));
                }
                // Only the lines that show: the content box, clipped by the window and the scroll views around it.
                let visible = ((clip[1] / s - oy) / k, (clip[3] / s - oy) / k);
                let placed = ed.glyphs(text, Some(visible));
                glyphs |= push_glyphs(&mut quads, text, &placed, (ox, oy), k, s, &[color], clip);
                if focused {
                    for r in ed.compose(text) {
                        quads.push(fill([r[0], r[3] - 1.0, r[2], r[3]], color));
                    }
                    let (anchor, head) = ed.selection_range();
                    if anchor == head
                        && let Some(r) = ed.caret(text)
                    {
                        let caret = rgba(v.caret_color.unwrap_or(v.color), alpha);
                        let mut q = fill(r, caret);
                        q.rect[2] = q.rect[2].max(q.rect[0] + 1.0);
                        quads.push(q);
                    }
                }
            }
        }
        for q in &mut quads[from..] {
            q.extra.clip_radius = clip_r * s;
            for sp in spins.iter().rev() {
                spin_quad(q, sp, s);
            }
            for f in &filters {
                q.extra.filter = both(q.extra.filter, f.0);
            }
        }
        for t in thumbs {
            quads.push(thumb_quad(t, &self.nodes));
        }
        if self.debug_layout {
            // Every box's edge, on top: a hue per node, so neighbours can be told apart.
            const HUES: [[f32; 4]; 6] = [[0.95, 0.3, 0.3, 0.8], [0.3, 0.75, 0.35, 0.8], [0.3, 0.5, 0.95, 0.8], [0.95, 0.7, 0.2, 0.8], [0.75, 0.35, 0.9, 0.8], [0.2, 0.8, 0.85, 0.8]];
            for b in &self.boxes {
                let rect = [snap(b.rect[0]), snap(b.rect[1]), snap(b.rect[2]), snap(b.rect[3])];
                if rect[2] > rect[0] && rect[3] > rect[1] {
                    quads.push(Quad { rect, color: [0.0; 4], uv: [0.0; 4], clip: NO_CLIP, radius: 0.0, border: 1.0, border_color: HUES[b.id as usize % HUES.len()], shadow: None, image: None, extra: Extra::NONE });
                }
            }
        }
        // Colour glyphs (emoji) sample the colour atlas as an image: one texture, made again only when it changed.
        if quads.iter().any(|q| q.image.is_some_and(|i| i.id == COLOR_GLYPHS))
            && let Some(text) = self.text.as_ref()
        {
            let a = text.color_atlas();
            if self.color_glyphs.as_ref().is_none_or(|(v, _)| *v != a.version()) {
                self.color_glyphs = Some(a.read(|px, v| (v, Pixels::new(a.width, a.height, px.to_vec()))));
            }
            let px = self.color_glyphs.as_ref().expect("just made").1.clone();
            for q in quads.iter_mut().filter(|q| q.image.is_some_and(|i| i.id == COLOR_GLYPHS)) {
                q.image = Some(ImageRef { id: px.id, tint: false });
            }
            images.insert(px.id, px);
        }
        let atlas = if glyphs { self.text.as_ref().map(|t| t.atlas()) } else { None };
        self.html_requests();
        Scene { clear: self.clear, quads, size_px: self.viewport_px, atlas, images }
    }

    /// The topmost node under a point (logical px), ignoring what its ancestors clip away.
    pub fn hit(&self, x: f32, y: f32) -> Option<u32> {
        // A rotated subtree is tested with the point turned back: undo the outermost spin first.
        let mut spins: Vec<Spin> = Vec::new();
        let mut found = None;
        for (i, b) in self.boxes.iter().enumerate() {
            while spins.last().is_some_and(|sp| sp.end <= i) {
                spins.pop();
            }
            spins.extend(b.spin);
            let (mut px, mut py) = (x, y);
            for sp in &spins {
                let (sn, cs) = (-sp.angle).sin_cos();
                let (dx, dy) = (px - sp.pivot[0], py - sp.pivot[1]);
                (px, py) = (sp.pivot[0] + dx * cs - dy * sn, sp.pivot[1] + dx * sn + dy * cs);
            }
            let inside = |r: &[f32; 4]| px >= r[0] && px < r[2] && py >= r[1] && py < r[3];
            if inside(&b.rect) && inside(&b.clip) && !self.nodes[&b.id].v.no_pointer && !self.follows(b.id) {
                found = Some(b.id);
            }
        }
        found
    }

    /// Whether the node is the FOLLOW_POINTER node or inside it: the pointer goes through those.
    fn follows(&self, id: u32) -> bool {
        let Some((f, ..)) = self.follow else { return false };
        let mut at = Some(id);
        while let Some(i) = at {
            if i == f {
                return true;
            }
            at = self.nodes.get(&i).and_then(|n| n.parent);
        }
        false
    }

    /// The text of a text node (for tests and debugging).
    pub fn text_of(&self, id: u32) -> Option<&str> {
        self.nodes.get(&id).filter(|n| n.kind == p::node_kind::TEXT).map(|n| n.text.as_str())
    }

    /// The node a press at this point targets: the topmost node under it, if a
    /// node on its path to the root listens for presses.
    pub fn press_target(&self, x: f32, y: f32) -> Option<u32> {
        self.listener_target(x, y, event_mask::PRESS)
    }

    /// The topmost node under a point, if a node on its path to the root listens for `mask` (an `event_mask` bit).
    pub fn listener_target(&self, x: f32, y: f32, mask: u32) -> Option<u32> {
        if self.on_thumb(x, y) {
            return None; // a scrollbar thumb is the core's, not the content's
        }
        let hit = self.hit(x, y)?;
        // Over a run in spans, the innermost span is the target (it bubbles up through the others in JS).
        let spans = self.spans_at(hit, x, y).unwrap_or(&[]);
        let target = spans.last().copied().unwrap_or(hit);
        if spans.iter().any(|s| self.nodes.get(s).is_some_and(|n| n.listen & mask != 0)) {
            return Some(target);
        }
        let mut a = Some(hit);
        while let Some(id) = a {
            let n = &self.nodes[&id];
            if n.listen & mask != 0 {
                return Some(target);
            }
            a = n.parent;
        }
        None
    }

    /// Whether the node exists.
    pub fn has_node(&self, id: u32) -> bool {
        self.nodes.contains_key(&id)
    }

    /// Every node id, sorted.
    pub fn ids(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.nodes.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// The root node, if any.
    pub fn root(&self) -> Option<u32> {
        self.root
    }

    /// Checks the tree's internal consistency: parent and child links agree,
    /// Taffy's tree mirrors ours, there are no cycles, and the root and the
    /// laid-out boxes name live nodes. For tests and fuzzing.
    pub fn check(&self) -> Result<(), String> {
        for (&id, n) in &self.nodes {
            if let Some(p) = n.parent {
                let pn = self.nodes.get(&p).ok_or(format!("{id}'s parent {p} doesn't exist"))?;
                if !pn.children.contains(&id) {
                    return Err(format!("{id} names {p} as parent, but {p} doesn't list it"));
                }
            }
            for &c in &n.children {
                let cn = self.nodes.get(&c).ok_or(format!("{id} lists missing child {c}"))?;
                if cn.parent != Some(id) {
                    return Err(format!("{id} lists {c}, whose parent is {:?}", cn.parent));
                }
            }
            let mut sorted = n.children.clone();
            sorted.sort_unstable();
            sorted.dedup();
            if sorted.len() != n.children.len() {
                return Err(format!("{id} lists a child twice"));
            }
            let theirs = self.taffy.children(n.taffy).map_err(|e| e.to_string())?;
            let ours: Vec<NodeId> = n.children.iter().map(|c| self.nodes[c].taffy).collect();
            if theirs != ours {
                return Err(format!("Taffy's children of {id} differ from Mantou's"));
            }
            let (mut a, mut steps) = (n.parent, 0);
            while let Some(x) = a {
                steps += 1;
                if steps > self.nodes.len() {
                    return Err(format!("cycle above {id}"));
                }
                a = self.nodes.get(&x).and_then(|n| n.parent);
            }
        }
        if let Some(r) = self.root
            && !self.nodes.contains_key(&r)
        {
            return Err(format!("root {r} doesn't exist"));
        }
        if !self.layout_dirty
            && let Some(LaidOut { id, .. }) = self.boxes.iter().find(|b| !self.nodes.contains_key(&b.id))
        {
            return Err(format!("laid-out box of missing node {id}"));
        }
        Ok(())
    }

    /// Scale factor of the last viewport.
    /// The viewport's size in device px.
    pub fn viewport_px(&self) -> (u32, u32) {
        self.viewport_px
    }

    pub fn scale(&self) -> f32 {
        self.scale
    }
}

/// Stands for the colour glyph atlas's texture in a quad until the scene is built.
const COLOR_GLYPHS: u32 = u32::MAX;

/// Glyph quads for text laid out from `origin` (window px) and drawn at scale
/// `k` (a transform's), on a display of scale `s`, in `colors[g.span]` (the
/// first colour for glyphs past the end); returns whether any was drawn.
#[allow(clippy::too_many_arguments)]
fn push_glyphs(quads: &mut Vec<Quad>, text: &mut TextEngine, glyphs: &[PlacedGlyph], origin: (f32, f32), k: f32, s: f32, colors: &[[f32; 4]], clip: [f32; 4]) -> bool {
    let mut any = false;
    for g in glyphs {
        let color = colors.get(g.span as usize).or(colors.first()).copied().unwrap_or([0.0; 4]);
        if color[3] <= 0.0 {
            continue;
        }
        let (gx, gy) = ((origin.0 + g.x * k) * s, (origin.1 + g.y * k) * s);
        let size = g.size * k * s;
        if size < 0.5 {
            continue; // too small to see (a scale near 0)
        }
        let Some(e) = text.glyph_synth(g.font, g.id, size, gx - gx.floor(), g.skew, g.embolden) else { continue };
        let x0 = gx.floor() + e.left as f32;
        let y0 = gy.round() - e.top as f32;
        let rect = [x0, y0, x0 + e.w as f32, y0 + e.h as f32];
        if !overlaps(rect, clip) {
            continue;
        }
        let uv = [e.x as f32, e.y as f32, (e.x + e.w) as f32, (e.y + e.h) as f32];
        // An emoji keeps its own colours (only the opacity applies); its texture is set once the scene is built.
        let (color, image) = if e.color { ([1.0, 1.0, 1.0, color[3]], Some(ImageRef { id: COLOR_GLYPHS, tint: false })) } else { (color, None) };
        quads.push(Quad { rect, color, uv, clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image, extra: Extra::NONE });
        any = true;
    }
    any
}

/// A transform from layout coordinates to the window's: scale by `k`, then move by `o`.
#[derive(Clone, Copy)]
struct Xf {
    k: f32,
    o: [f32; 2],
}

impl Xf {
    fn rect(&self, r: [f32; 4]) -> [f32; 4] {
        [r[0] * self.k + self.o[0], r[1] * self.k + self.o[1], r[2] * self.k + self.o[0], r[3] * self.k + self.o[1]]
    }
}

fn finite(v: f32, or: f32) -> f32 {
    if v.is_finite() { v } else { or }
}

/// The width a node of auto width will be stretched to, if its parent is a column that stretches it (its own
/// alignSelf, else the parent's alignItems): the space available less its margins, within its min and max.
fn stretched_width(nodes: &Nodes, styles: &HashMap<u32, Vec<(Prop, Value)>>, node: &Node, style: &Style, avail: AvailableSpace) -> Option<f32> {
    let AvailableSpace::Definite(space) = avail else { return None };
    if !style.size.width.is_auto() {
        return None;
    }
    let parent = nodes.get(&node.parent?)?;
    let mut ps = Style { flex_direction: FlexDirection::Column, ..Style::default() };
    let mut pv = Visual::default();
    let shared = styles.get(&parent.shared).map(|v| v.as_slice()).unwrap_or(&[]);
    for (prop, value) in shared.iter().copied().chain(parent.own.iter().map(|(k, v)| (*k, *v))) {
        set_prop(&mut ps, &mut pv, prop, value);
    }
    let column = ps.display == Display::Flex && matches!(ps.flex_direction, FlexDirection::Column | FlexDirection::ColumnReverse);
    // `normal` (Taffy's default) stretches flex items too.
    let align = style.align_self.unwrap_or(ps.align_items);
    let stretch = matches!(align.keyword, taffy::style::AlignItemsKeyword::Stretch | taffy::style::AlignItemsKeyword::Normal);
    if !column || !stretch {
        return None;
    }
    let len = |l: LengthPercentageAuto| if l.is_auto() { 0.0 } else { l.resolve_to_option(space, |_, _| 0.0).unwrap_or(0.0) };
    let mut w = space - len(style.margin.left) - len(style.margin.right);
    if let Some(max) = style.max_size.width.resolve_to_option(space, |_, _| 0.0) {
        w = w.min(max);
    }
    if let Some(min) = style.min_size.width.resolve_to_option(space, |_, _| 0.0) {
        w = w.max(min);
    }
    Some(w.max(0.0))
}

fn intersect(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])]
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

fn lp(l: Length) -> LengthPercentage {
    match l {
        Length::Px(v) => LengthPercentage::length(v),
        Length::Percent(v) => LengthPercentage::percent(v / 100.0),
        Length::Auto => LengthPercentage::length(0.0),
    }
}

fn lpa(l: Length) -> LengthPercentageAuto {
    match l {
        Length::Px(v) => LengthPercentageAuto::length(v),
        Length::Percent(v) => LengthPercentageAuto::percent(v / 100.0),
        Length::Auto => LengthPercentageAuto::auto(),
    }
}

fn dim(l: Length) -> Dimension {
    match l {
        Length::Px(v) => Dimension::length(v),
        Length::Percent(v) => Dimension::percent(v / 100.0),
        Length::Auto => Dimension::auto(),
    }
}

fn set_prop(s: &mut Style, v: &mut Visual, prop: Prop, value: Value) {
    use crate::protocol::{align_items as ai, align_self as aself, flex_direction as fd, justify_content as jc};
    let len = || match value {
        Value::Length(l) => l,
        _ => Length::Auto,
    };
    let num = || match value {
        Value::F32(v) => v,
        _ => 0.0,
    };
    let e = match value {
        Value::Enum(e) => e,
        _ => 0,
    };
    let align = |e: u32| match e {
        ai::START => AlignItems::START,
        ai::END => AlignItems::END,
        ai::CENTER => AlignItems::CENTER,
        ai::BASELINE => AlignItems::BASELINE,
        _ => AlignItems::STRETCH,
    };
    match prop {
        Prop::Display => {
            s.display = match e {
                p::display::NONE => Display::None,
                p::display::GRID => Display::Grid,
                _ => Display::Flex,
            }
        }
        Prop::GridColumns => {
            let n = num().clamp(0.0, 1000.0) as u16;
            s.grid_template_columns = if n > 0 { taffy::style_helpers::evenly_sized_tracks(n) } else { Vec::new() };
        }
        Prop::GridMinColumnWidth => {
            s.grid_template_columns = match len() {
                Length::Px(w) if w > 0.0 => {
                    let track: taffy::style::TrackSizingFunction = taffy::style_helpers::minmax(taffy::style_helpers::length(w), taffy::style_helpers::fr(1.0));
                    vec![taffy::style_helpers::repeat("auto-fill", vec![track])]
                }
                _ => Vec::new(),
            };
        }
        Prop::GridColumnSpan => s.grid_column = taffy::Line { start: taffy::style_helpers::auto(), end: taffy::style_helpers::span(num().clamp(1.0, 1000.0) as u16) },
        Prop::GridRowSpan => s.grid_row = taffy::Line { start: taffy::style_helpers::auto(), end: taffy::style_helpers::span(num().clamp(1.0, 1000.0) as u16) },
        Prop::AspectRatio => s.aspect_ratio = (num() > 0.0 && num().is_finite()).then(|| num()),
        Prop::PointerEvents => v.no_pointer = e == p::pointer_events::NONE,
        Prop::FlexDirection => {
            s.flex_direction = match e {
                fd::ROW => FlexDirection::Row,
                fd::ROW_REVERSE => FlexDirection::RowReverse,
                fd::COLUMN_REVERSE => FlexDirection::ColumnReverse,
                _ => FlexDirection::Column,
            }
        }
        Prop::FlexWrap => s.flex_wrap = if e == p::flex_wrap::WRAP { FlexWrap::Wrap } else { FlexWrap::NoWrap },
        Prop::JustifyContent => {
            s.justify_content = match e {
                jc::END => AlignContent::END,
                jc::CENTER => AlignContent::CENTER,
                jc::SPACE_BETWEEN => AlignContent::SPACE_BETWEEN,
                jc::SPACE_AROUND => AlignContent::SPACE_AROUND,
                jc::SPACE_EVENLY => AlignContent::SPACE_EVENLY,
                _ => AlignContent::START,
            }
        }
        Prop::AlignItems => s.align_items = align(e),
        Prop::AlignSelf => s.align_self = if e == aself::AUTO { None } else { Some(align(e - 1)) },
        Prop::FlexGrow => s.flex_grow = num(),
        Prop::FlexShrink => s.flex_shrink = num(),
        Prop::FlexBasis => s.flex_basis = dim(len()),
        Prop::Width => s.size.width = dim(len()),
        Prop::Height => s.size.height = dim(len()),
        Prop::MinWidth => s.min_size.width = lpa(len()),
        Prop::MinHeight => s.min_size.height = lpa(len()),
        Prop::MaxWidth => s.max_size.width = lpa(len()),
        Prop::MaxHeight => s.max_size.height = lpa(len()),
        Prop::PaddingTop => s.padding.top = lp(len()),
        Prop::PaddingRight => s.padding.right = lp(len()),
        Prop::PaddingBottom => s.padding.bottom = lp(len()),
        Prop::PaddingLeft => s.padding.left = lp(len()),
        Prop::MarginTop => s.margin.top = lpa(len()),
        Prop::MarginRight => s.margin.right = lpa(len()),
        Prop::MarginBottom => s.margin.bottom = lpa(len()),
        Prop::MarginLeft => s.margin.left = lpa(len()),
        Prop::RowGap => s.gap.height = lp(len()),
        Prop::ColumnGap => s.gap.width = lp(len()),
        Prop::Position => {
            v.position = e as u8;
            // Fixed is placed by the core against the window, sticky by it against its scroll view; taffy only sizes them.
            s.position = if e == p::position::ABSOLUTE || e == p::position::FIXED { Position::Absolute } else { Position::Relative };
        }
        Prop::Top => {
            s.inset.top = lpa(len());
            v.inset[0] = if let Length::Px(px) = len() { Some(px) } else { None };
        }
        Prop::Right => {
            s.inset.right = lpa(len());
            v.inset[1] = if let Length::Px(px) = len() { Some(px) } else { None };
        }
        Prop::Bottom => {
            s.inset.bottom = lpa(len());
            v.inset[2] = if let Length::Px(px) = len() { Some(px) } else { None };
        }
        Prop::Left => {
            s.inset.left = lpa(len());
            v.inset[3] = if let Length::Px(px) = len() { Some(px) } else { None };
        }
        Prop::BackgroundColor => {
            if let Value::Color(c) = value {
                v.background = c
            }
        }
        Prop::Opacity => v.opacity = num().clamp(0.0, 1.0),
        Prop::Color => {
            if let Value::Color(c) = value {
                v.color = c;
                v.color_set = true;
            }
        }
        Prop::ObjectFit => v.fit = e,
        Prop::Cursor => v.cursor = e,
        Prop::TranslateX => v.translate[0] = finite(num(), 0.0),
        Prop::TranslateY => v.translate[1] = finite(num(), 0.0),
        Prop::Scale => v.scale = finite(num(), 1.0).max(0.0),
        Prop::Rotate => v.rotate = finite(num(), 0.0),
        Prop::Layout => {} // only a key for `transition`
        Prop::Brightness => v.brightness = finite(num(), 1.0).clamp(0.0, 10.0),
        Prop::Saturate => v.saturate = finite(num(), 1.0).clamp(0.0, 10.0),
        Prop::Contrast => v.contrast = finite(num(), 1.0).clamp(0.0, 10.0),
        Prop::Invert => v.invert = finite(num(), 0.0).clamp(0.0, 1.0),
        Prop::BorderTopColor | Prop::BorderRightColor | Prop::BorderBottomColor | Prop::BorderLeftColor => {
            if let Value::Color(c) = value {
                let side = match prop {
                    Prop::BorderTopColor => 0,
                    Prop::BorderRightColor => 1,
                    Prop::BorderBottomColor => 2,
                    _ => 3,
                };
                v.side_colors[side] = c;
            }
        }
        Prop::FontSize => v.text.size = num().clamp(1.0, 1000.0),
        Prop::FontWeight => v.text.weight = num().clamp(1.0, 1000.0),
        Prop::LineHeight => v.text.line_height = num().clamp(0.0, 10.0),
        Prop::TextAlign => {
            v.text.align = match e {
                p::text_align::CENTER => Align::Center,
                p::text_align::END => Align::End,
                _ => Align::Start,
            }
        }
        Prop::MaxLines => v.text.max_lines = num().clamp(0.0, 10_000.0) as u32,
        Prop::FontStyle => v.text.italic = e == p::font_style::ITALIC,
        Prop::TextDecoration => {
            v.text.decoration = match e {
                p::text_decoration::UNDERLINE => mantou_text::Decoration::Underline,
                p::text_decoration::LINE_THROUGH => mantou_text::Decoration::LineThrough,
                _ => mantou_text::Decoration::None,
            }
        }
        Prop::LetterSpacing => v.text.letter_spacing = finite(num(), 0.0).clamp(-100.0, 100.0),
        Prop::TextTransform => {
            v.text.transform = match e {
                p::text_transform::UPPERCASE => mantou_text::Transform::Upper,
                p::text_transform::LOWERCASE => mantou_text::Transform::Lower,
                p::text_transform::CAPITALIZE => mantou_text::Transform::Capitalize,
                _ => mantou_text::Transform::None,
            }
        }
        Prop::UserSelect => v.user_select = e == p::user_select::TEXT,
        Prop::WhiteSpace => v.text.nowrap = e != p::white_space::NORMAL,
        Prop::WordBreak => {
            v.text.word_break = match e {
                p::word_break::BREAK_ALL => mantou_text::WordBreakMode::BreakAll,
                p::word_break::KEEP_ALL => mantou_text::WordBreakMode::KeepAll,
                p::word_break::BREAK_WORD => mantou_text::WordBreakMode::BreakWord,
                _ => mantou_text::WordBreakMode::Normal,
            }
        }
        Prop::TextOverflow => v.text.ellipsis = e != p::text_overflow::CLIP,
        Prop::ShadowX => v.shadow[0] = num(),
        Prop::ShadowY => v.shadow[1] = num(),
        Prop::ShadowBlur => v.shadow[2] = num().max(0.0),
        Prop::ShadowSpread => v.shadow[3] = num(),
        Prop::ShadowColor => {
            if let Value::Color(c) = value {
                v.shadow_color = c
            }
        }
        Prop::FontFamily => {
            if let Value::Family(f) = value {
                v.text.family = f
            }
        }
        Prop::Overflow => {
            v.clips = e == p::overflow::HIDDEN || e == p::overflow::SCROLL;
            v.scrolls = e == p::overflow::SCROLL;
            // Also tells Taffy, so the box's automatic minimum size is 0 (CSS):
            // a clipping box can be smaller than its content. Scrollbars are
            // drawn over the content, so they take no space (scrollbar_width 0).
            let o = match e {
                p::overflow::HIDDEN => taffy::style::Overflow::Hidden,
                p::overflow::SCROLL => taffy::style::Overflow::Scroll,
                _ => taffy::style::Overflow::Visible,
            };
            s.overflow = taffy::geometry::Point { x: o, y: o };
            s.scrollbar_width = 0.0;
        }
        Prop::Scrollbar => v.no_scrollbar = e == p::scrollbar::NONE,
        Prop::ScrollbarColor => {
            if let Value::Color(c) = value {
                v.scrollbar_color = Some(c)
            }
        }
        Prop::BorderRadius => v.radius = num().max(0.0),
        Prop::BorderTopLeftRadius => v.radii_p1[0] = num().max(0.0) + 1.0,
        Prop::BorderTopRightRadius => v.radii_p1[1] = num().max(0.0) + 1.0,
        Prop::BorderBottomRightRadius => v.radii_p1[2] = num().max(0.0) + 1.0,
        Prop::BorderBottomLeftRadius => v.radii_p1[3] = num().max(0.0) + 1.0,
        Prop::BorderTopWidth => {
            v.widths_p1[0] = num().max(0.0) + 1.0;
            s.border.top = LengthPercentage::length(num().max(0.0));
        }
        Prop::BorderRightWidth => {
            v.widths_p1[1] = num().max(0.0) + 1.0;
            s.border.right = LengthPercentage::length(num().max(0.0));
        }
        Prop::BorderBottomWidth => {
            v.widths_p1[2] = num().max(0.0) + 1.0;
            s.border.bottom = LengthPercentage::length(num().max(0.0));
        }
        Prop::BorderLeftWidth => {
            v.widths_p1[3] = num().max(0.0) + 1.0;
            s.border.left = LengthPercentage::length(num().max(0.0));
        }
        Prop::GradientColor => {
            if let Value::Color(c) = value {
                v.gradient = c
            }
        }
        Prop::GradientAngle => v.gradient_angle = finite(num(), 180.0) - 180.0, // 0 stored = the default, 180
        Prop::GradientMidColor => {
            if let Value::Color(c) = value {
                v.gradient_mid = c
            }
        }
        Prop::GradientMidAt => v.gradient_mid_at = finite(num(), 50.0) / 100.0 - 0.5,
        Prop::GradientShape => v.gradient_radial = e == 1,
        Prop::ZIndex => v.z = finite(num(), 0.0).clamp(-1e6, 1e6) as i32,
        Prop::BorderWidth => {
            let w = num().max(0.0);
            v.border = w;
            v.widths_p1 = [0.0; 4]; // a width for all sides replaces any set for one
            let l = LengthPercentage::length(w);
            s.border = taffy::geometry::Rect { left: l, right: l, top: l, bottom: l };
        }
        Prop::BorderColor => {
            if let Value::Color(c) = value {
                v.border_color = c
            }
        }
        Prop::PlaceholderColor => {
            if let Value::Color(c) = value {
                v.placeholder_color = Some(c)
            }
        }
        Prop::CaretColor => {
            if let Value::Color(c) = value {
                v.caret_color = Some(c)
            }
        }
        Prop::SelectionColor => {
            if let Value::Color(c) = value {
                v.selection_color = Some(c)
            }
        }
        Prop::FocusRingColor => {
            if let Value::Color(c) = value {
                v.focus_ring_color = Some(c)
            }
        }
        Prop::FocusRingOffset => v.focus_ring_offset = Some(num()),
        Prop::AlignContent => {
            use crate::protocol::align_content as ac;
            s.align_content = match e {
                ac::START => AlignContent::START,
                ac::END => AlignContent::END,
                ac::CENTER => AlignContent::CENTER,
                ac::SPACE_BETWEEN => AlignContent::SPACE_BETWEEN,
                ac::SPACE_AROUND => AlignContent::SPACE_AROUND,
                ac::SPACE_EVENLY => AlignContent::SPACE_EVENLY,
                _ => AlignContent::STRETCH,
            }
        }
    }
}
