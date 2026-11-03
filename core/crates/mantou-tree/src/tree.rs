//! The shadow tree (design §5.1, §8): nodes created by the Worker's ops,
//! laid out with Taffy (text measured by mantou-text), turned into a scene of
//! quads (rectangles and glyphs), and hit-tested.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use mantou_text::{Align, AtlasImage, TextEngine, TextStyle};

use taffy::prelude::*;
use taffy::style::{AlignContent, AlignItems, Dimension, LengthPercentage, LengthPercentageAuto};

use crate::decode::{DecodeError, Length, Op, Value, decode};
use crate::protocol::{self as p, Prop, event_mask};

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
}

impl Quad {
    pub fn is_glyph(&self) -> bool {
        self.uv[2] > self.uv[0]
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
            out.push_str(&format!("quad {x0} {y0} {x1} {y1} {}", hex(q.color)));
            if q.radius > 0.0 {
                out.push_str(&format!(" radius {}", q.radius));
            }
            if q.border > 0.0 {
                out.push_str(&format!(" border {} {}", q.border, hex(q.border_color)));
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
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Visual {
    background: u32,
    radius: f32,
    border: f32,
    border_color: u32,
    opacity: f32,
    hidden: bool,
    clips: bool,
    color: u32,
    text: TextStyle,
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
}

/// A laid-out box in paint order: the node, its border box and content box
/// (logical px), and the clip its ancestors put on it (logical px).
#[derive(Clone, Copy)]
struct LaidOut {
    id: u32,
    rect: [f32; 4],
    content: [f32; 4],
    clip: [f32; 4],
}

pub struct Tree {
    taffy: TaffyTree<u32>,
    /// Created with the first text node.
    text: Option<TextEngine>,
    nodes: HashMap<u32, Node>,
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
            nodes: HashMap::new(),
            styles: HashMap::new(),
            root: None,
            clear: [0.08, 0.08, 0.1, 1.0],
            title: None,
            viewport_px: (800, 600),
            scale: 1.0,
            layout_dirty: true,
            boxes: Vec::new(),
            stats: TreeStats::default(),
        }
    }

    pub fn stats(&self) -> TreeStats {
        self.stats
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Takes the title set since the last call, if any.
    pub fn take_title(&mut self) -> Option<String> {
        self.title.take()
    }

    /// Decodes and applies a batch. A malformed batch is rejected whole.
    pub fn apply(&mut self, bytes: &[u8]) -> Result<ApplyReport, DecodeError> {
        let ops = decode(bytes)?;
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
                let taffy = match kind {
                    p::node_kind::VIEW => self.taffy.new_leaf(Style::default()),
                    p::node_kind::TEXT => {
                        self.text.get_or_insert_with(TextEngine::new);
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
            Op::Listen { id, mask } => self.node(id)?.listen = mask,
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
                    let t = node.taffy;
                    let _ = self.taffy.mark_dirty(t);
                    self.layout_dirty = true;
                }
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
        if self.node(parent)?.kind == p::node_kind::TEXT {
            return Err(format!("INSERT: {parent} is a text node; text nodes have no children"));
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
        let mut style = Style { flex_direction: FlexDirection::Column, ..Style::default() };
        let mut v = Visual { opacity: 1.0, color: 0xff_00_00_00, text: TextStyle::default(), ..Visual::default() };
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
        let _ = self.taffy.set_style(taffy, style);
        self.nodes.get_mut(&id).expect("exists").v = v;
        self.layout_dirty = true;
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
        if let Some(root) = self.root {
            self.restyle(root);
        }
        self.layout_dirty = true;
    }

    /// Lays out the tree if anything changed since the last layout.
    pub fn layout(&mut self) -> bool {
        if !self.layout_dirty {
            return false;
        }
        self.layout_dirty = false;
        let Some(root) = self.root else {
            self.boxes.clear();
            return true;
        };
        let (vw, vh) = self.viewport_logical();
        let rt = self.nodes[&root].taffy;
        let space = Size { width: AvailableSpace::Definite(vw), height: AvailableSpace::Definite(vh) };
        let (nodes, mut text) = (&self.nodes, self.text.as_mut());
        let measured = self.taffy.compute_layout_with_measure(rt, space, |inputs, _, ctx, style| {
            taffy::compute_leaf_layout(inputs, style, |_, _| 0.0, |known, avail| {
                let (Some(node), Some(text)) = (ctx.and_then(|id| nodes.get(id)), text.as_deref_mut()) else { return Size::ZERO };
                let width = known.width.or(match avail.width {
                    AvailableSpace::Definite(w) => Some(w),
                    AvailableSpace::MinContent => Some(0.0),
                    AvailableSpace::MaxContent => None,
                });
                let l = text.layout(&node.text, &node.v.text, width);
                // Rounded up, so laying the text out again at exactly this width wraps the same.
                Size { width: known.width.unwrap_or(l.width.ceil()), height: known.height.unwrap_or(l.height.ceil()) }
            })
        });
        if measured.is_ok() {
            self.stats.layouts += 1;
        }
        self.boxes.clear();
        self.collect_boxes(root, 0.0, 0.0, [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY]);
        true
    }

    fn collect_boxes(&mut self, id: u32, px: f32, py: f32, clip: [f32; 4]) {
        let node = &self.nodes[&id];
        if node.v.hidden {
            return;
        }
        let Ok(l) = self.taffy.layout(node.taffy) else { return };
        let (x, y) = (px + l.location.x, py + l.location.y);
        let rect = [x, y, x + l.size.width, y + l.size.height];
        let (pd, bd) = (l.padding, l.border);
        let content = [x + pd.left + bd.left, y + pd.top + bd.top, rect[2] - pd.right - bd.right, rect[3] - pd.bottom - bd.bottom];
        self.boxes.push(LaidOut { id, rect, content, clip });
        let inner = if node.v.clips { intersect(clip, rect) } else { clip };
        for c in self.nodes[&id].children.clone() {
            self.collect_boxes(c, x, y, inner);
        }
    }

    /// The node's box in logical pixels, after the last layout.
    pub fn rect(&self, id: u32) -> Option<[f32; 4]> {
        self.boxes.iter().find(|b| b.id == id).map(|b| b.rect)
    }

    /// Builds the scene from the last layout (call `layout` first). Text is
    /// laid out at its final width and its glyphs rasterized into the atlas.
    pub fn scene(&mut self) -> Scene {
        let s = self.scale;
        let snap = |v: f32| (v * s).round();
        let mut quads = Vec::new();
        let rgba = |c: u32, alpha: f32| {
            let ch = |shift: u32| ((c >> shift) & 255) as f32 / 255.0;
            [ch(0), ch(8), ch(16), ch(24) * alpha]
        };
        let mut glyphs = false;
        for b in &self.boxes {
            let node = &self.nodes[&b.id];
            let mut alpha = node.v.opacity;
            let mut a = node.parent;
            while let Some(pid) = a {
                let pn = &self.nodes[&pid];
                alpha *= pn.v.opacity;
                a = pn.parent;
            }
            let clip = if b.clip[0].is_finite() { [snap(b.clip[0]), snap(b.clip[1]), snap(b.clip[2]), snap(b.clip[3])] } else { NO_CLIP };
            if clip[2] <= clip[0] || clip[3] <= clip[1] {
                continue; // clipped away entirely
            }
            let r = b.rect;
            let bg = rgba(node.v.background, alpha);
            let border_color = rgba(node.v.border_color, alpha);
            let border = if border_color[3] > 0.0 { (node.v.border * s).max(0.0) } else { 0.0 };
            let rect = [snap(r[0]), snap(r[1]), snap(r[2]), snap(r[3])];
            if (bg[3] > 0.0 || border > 0.0) && rect[2] > rect[0] && rect[3] > rect[1] && overlaps(rect, clip) {
                quads.push(Quad { rect, color: bg, uv: [0.0; 4], clip, radius: node.v.radius * s, border, border_color });
            }
            if node.kind == p::node_kind::TEXT && !node.text.is_empty() {
                let color = rgba(node.v.color, alpha);
                if color[3] <= 0.0 {
                    continue;
                }
                let c = b.content;
                let Some(text) = self.text.as_mut() else { continue };
                let layout = text.layout(&node.text, &node.v.text, Some((c[2] - c[0]).max(0.0)));
                for g in &layout.glyphs {
                    let (gx, gy) = ((c[0] + g.x) * s, (c[1] + g.y) * s);
                    let Some(e) = text.glyph(g.font, g.id, g.size * s, gx - gx.floor()) else { continue };
                    let x0 = gx.floor() + e.left as f32;
                    let y0 = gy.round() - e.top as f32;
                    let rect = [x0, y0, x0 + e.w as f32, y0 + e.h as f32];
                    if !overlaps(rect, clip) {
                        continue;
                    }
                    let uv = [e.x as f32, e.y as f32, (e.x + e.w) as f32, (e.y + e.h) as f32];
                    quads.push(Quad { rect, color, uv, clip, radius: 0.0, border: 0.0, border_color: [0.0; 4] });
                    glyphs = true;
                }
            }
        }
        let atlas = if glyphs { self.text.as_ref().map(|t| t.atlas()) } else { None };
        Scene { clear: self.clear, quads, size_px: self.viewport_px, atlas }
    }

    /// The topmost node under a point (logical px), ignoring what its ancestors clip away.
    pub fn hit(&self, x: f32, y: f32) -> Option<u32> {
        let inside = |r: &[f32; 4]| x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
        self.boxes.iter().rev().find(|b| inside(&b.rect) && inside(&b.clip)).map(|b| b.id)
    }

    /// The text of a text node (for tests and debugging).
    pub fn text_of(&self, id: u32) -> Option<&str> {
        self.nodes.get(&id).filter(|n| n.kind == p::node_kind::TEXT).map(|n| n.text.as_str())
    }

    /// The node a press at this point targets: the topmost node under it, if a
    /// node on its path to the root listens for presses.
    pub fn press_target(&self, x: f32, y: f32) -> Option<u32> {
        let hit = self.hit(x, y)?;
        let mut a = Some(hit);
        while let Some(id) = a {
            let n = &self.nodes[&id];
            if n.listen & event_mask::PRESS != 0 {
                return Some(hit);
            }
            a = n.parent;
        }
        None
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
    pub fn scale(&self) -> f32 {
        self.scale
    }
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
        Prop::Display => s.display = if e == p::display::NONE { Display::None } else { Display::Flex },
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
        Prop::Position => s.position = if e == p::position::ABSOLUTE { Position::Absolute } else { Position::Relative },
        Prop::Top => s.inset.top = lpa(len()),
        Prop::Right => s.inset.right = lpa(len()),
        Prop::Bottom => s.inset.bottom = lpa(len()),
        Prop::Left => s.inset.left = lpa(len()),
        Prop::BackgroundColor => {
            if let Value::Color(c) = value {
                v.background = c
            }
        }
        Prop::Opacity => v.opacity = num().clamp(0.0, 1.0),
        Prop::Color => {
            if let Value::Color(c) = value {
                v.color = c
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
        Prop::Overflow => {
            v.clips = e == p::overflow::HIDDEN;
            // Also tells Taffy, so the box's automatic minimum size is 0 (CSS):
            // a clipping box can be smaller than its content.
            let o = if v.clips { taffy::style::Overflow::Hidden } else { taffy::style::Overflow::Visible };
            s.overflow = taffy::geometry::Point { x: o, y: o };
        }
        Prop::BorderRadius => v.radius = num().max(0.0),
        Prop::BorderWidth => {
            let w = num().max(0.0);
            v.border = w;
            let l = LengthPercentage::length(w);
            s.border = taffy::geometry::Rect { left: l, right: l, top: l, bottom: l };
        }
        Prop::BorderColor => {
            if let Value::Color(c) = value {
                v.border_color = c
            }
        }
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
