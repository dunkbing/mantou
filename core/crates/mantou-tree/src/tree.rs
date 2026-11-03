//! The shadow tree (design §5.1, §8): nodes created by the Worker's ops,
//! laid out with Taffy, turned into a scene of rectangles, and hit-tested.

use std::collections::{BTreeMap, HashMap};

use taffy::prelude::*;
use taffy::style::{AlignContent, AlignItems, Dimension, LengthPercentage, LengthPercentageAuto};

use crate::decode::{DecodeError, Length, Op, Value, decode};
use crate::protocol::{self as p, Prop, event_mask};

/// One filled rectangle, in device pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quad {
    /// x0, y0, x1, y1, snapped to device pixels.
    pub rect: [f32; 4],
    /// sRGB, straight alpha, 0–1 (opacity already applied).
    pub color: [f32; 4],
}

/// What the renderer draws for one frame. Immutable once built.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scene {
    pub clear: [f32; 4],
    pub quads: Vec<Quad>,
    /// Physical size it was laid out for.
    pub size_px: (u32, u32),
}

impl Scene {
    /// A stable text form, one line per item, for snapshots and debugging.
    pub fn dump(&self) -> String {
        let hex = |c: [f32; 4]| {
            let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            format!("#{:02x}{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]), b(c[3]))
        };
        let mut out = format!("size {}x{}\nclear {}\n", self.size_px.0, self.size_px.1, hex(self.clear));
        for q in &self.quads {
            let [x0, y0, x1, y1] = q.rect;
            out.push_str(&format!("quad {x0} {y0} {x1} {y1} {}\n", hex(q.color)));
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

struct Node {
    taffy: NodeId,
    parent: Option<u32>,
    children: Vec<u32>,
    own: BTreeMap<Prop, Value>,
    shared: u32,
    listen: u32,
    background: u32,
    opacity: f32,
    hidden: bool,
}

pub struct Tree {
    taffy: TaffyTree<()>,
    nodes: HashMap<u32, Node>,
    styles: HashMap<u32, Vec<(Prop, Value)>>,
    root: Option<u32>,
    clear: [f32; 4],
    title: Option<String>,
    viewport_px: (u32, u32),
    scale: f32,
    layout_dirty: bool,
    /// Node boxes in paint order (logical px), for hit-testing.
    boxes: Vec<(u32, [f32; 4])>,
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
        // Rounding happens here, to device pixels, not in Taffy (NSH pitfall:
        // Taffy's rounding leaves stale values for absolutely positioned nodes).
        taffy.disable_rounding();
        Tree {
            taffy,
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
                if kind != p::node_kind::VIEW {
                    return Err(format!("CREATE: unknown kind {kind}"));
                }
                let taffy = self.taffy.new_leaf(Style::default()).map_err(|e| e.to_string())?;
                self.nodes.insert(id, Node {
                    taffy,
                    parent: None,
                    children: Vec::new(),
                    own: BTreeMap::new(),
                    shared: 0,
                    listen: 0,
                    background: 0,
                    opacity: 1.0,
                    hidden: false,
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
            Op::Unknown { .. } => {}
        }
        Ok(())
    }

    fn insert(&mut self, parent: u32, child: u32, before: u32) -> Result<(), String> {
        if parent == child {
            return Err("INSERT: a node cannot contain itself".into());
        }
        self.node(child)?;
        self.node(parent)?;
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
        let mut background = 0;
        let mut opacity = 1.0;
        let shared = self.styles.get(&node.shared).map(|v| v.as_slice()).unwrap_or(&[]);
        for (prop, value) in shared.iter().copied().chain(node.own.iter().map(|(k, v)| (*k, *v))) {
            set_prop(&mut style, &mut background, &mut opacity, prop, value);
        }
        if is_root {
            // The root fills the window, whatever it asked for.
            style.size = Size { width: Dimension::length(vw), height: Dimension::length(vh) };
            style.position = Position::Relative;
        }
        let hidden = style.display == Display::None;
        let taffy = node.taffy;
        let _ = self.taffy.set_style(taffy, style);
        let node = self.nodes.get_mut(&id).expect("exists");
        node.background = background;
        node.opacity = opacity;
        node.hidden = hidden;
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
        if self.taffy.compute_layout(rt, space).is_ok() {
            self.stats.layouts += 1;
        }
        self.boxes.clear();
        self.collect_boxes(root, 0.0, 0.0);
        true
    }

    fn collect_boxes(&mut self, id: u32, px: f32, py: f32) {
        let node = &self.nodes[&id];
        if node.hidden {
            return;
        }
        let Ok(l) = self.taffy.layout(node.taffy) else { return };
        let (x, y) = (px + l.location.x, py + l.location.y);
        self.boxes.push((id, [x, y, x + l.size.width, y + l.size.height]));
        for c in self.nodes[&id].children.clone() {
            self.collect_boxes(c, x, y);
        }
    }

    /// The node's box in logical pixels, after the last layout.
    pub fn rect(&self, id: u32) -> Option<[f32; 4]> {
        self.boxes.iter().find(|(n, _)| *n == id).map(|(_, r)| *r)
    }

    /// Builds the scene from the last layout (call `layout` first).
    pub fn scene(&self) -> Scene {
        let s = self.scale;
        let snap = |v: f32| (v * s).round();
        let mut quads = Vec::new();
        for &(id, r) in &self.boxes {
            let node = &self.nodes[&id];
            let mut alpha = node.opacity;
            let mut a = node.parent;
            while let Some(pid) = a {
                let pn = &self.nodes[&pid];
                alpha *= pn.opacity;
                a = pn.parent;
            }
            let c = node.background;
            let ca = ((c >> 24) & 255) as f32 / 255.0 * alpha;
            if ca <= 0.0 {
                continue;
            }
            let rect = [snap(r[0]), snap(r[1]), snap(r[2]), snap(r[3])];
            if rect[2] <= rect[0] || rect[3] <= rect[1] {
                continue;
            }
            let ch = |shift: u32| ((c >> shift) & 255) as f32 / 255.0;
            quads.push(Quad { rect, color: [ch(0), ch(8), ch(16), ca] });
        }
        Scene { clear: self.clear, quads, size_px: self.viewport_px }
    }

    /// The topmost node under a point (logical px).
    pub fn hit(&self, x: f32, y: f32) -> Option<u32> {
        self.boxes.iter().rev().find(|(_, r)| x >= r[0] && x < r[2] && y >= r[1] && y < r[3]).map(|(id, _)| *id)
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
            && let Some((id, _)) = self.boxes.iter().find(|(id, _)| !self.nodes.contains_key(id))
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

fn set_prop(s: &mut Style, background: &mut u32, opacity: &mut f32, prop: Prop, value: Value) {
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
                *background = c
            }
        }
        Prop::Opacity => *opacity = num().clamp(0.0, 1.0),
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
