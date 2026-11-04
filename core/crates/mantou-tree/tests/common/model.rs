//! Random UI trees and mutations, shared by the stable random tests
//! (tests/random.rs, tests/layout.rs) and the cargo-fuzz targets (core/fuzz),
//! which include this file. A `Model` keeps the expected state, so a test can
//! rebuild it from scratch and compare.
#![allow(dead_code)]

use std::collections::BTreeMap;

use mantou_tree::protocol::Prop;
use mantou_tree::{Length, Ops, Value};

/// Where randomness comes from: a seeded PRNG in tests, the fuzzer's bytes in fuzzing.
pub trait Source {
    fn u32(&mut self) -> u32;
    fn below(&mut self, n: u32) -> u32 {
        if n == 0 { 0 } else { self.u32() % n }
    }
    fn chance(&mut self, percent: u32) -> bool {
        self.below(100) < percent
    }
}

/// xorshift64*: small, fast, deterministic.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
}

impl Source for Rng {
    fn u32(&mut self) -> u32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 32) as u32
    }
}

/// The fuzzer's input, read four bytes at a time; zeros once it runs out.
pub struct Bytes<'a>(pub &'a [u8]);

impl Source for Bytes<'_> {
    fn u32(&mut self) -> u32 {
        let mut b = [0u8; 4];
        let n = self.0.len().min(4);
        b[..n].copy_from_slice(&self.0[..n]);
        self.0 = &self.0[n..];
        u32::from_le_bytes(b)
    }
}

impl Bytes<'_> {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub const PROPS: [Prop; 44] = [
    Prop::Display, Prop::FlexDirection, Prop::FlexWrap, Prop::JustifyContent, Prop::AlignItems,
    Prop::AlignSelf, Prop::FlexGrow, Prop::FlexShrink, Prop::FlexBasis, Prop::Width, Prop::Height,
    Prop::MinWidth, Prop::MinHeight, Prop::MaxWidth, Prop::MaxHeight, Prop::PaddingTop,
    Prop::PaddingRight, Prop::PaddingBottom, Prop::PaddingLeft, Prop::MarginTop, Prop::MarginRight,
    Prop::MarginBottom, Prop::MarginLeft, Prop::RowGap, Prop::ColumnGap, Prop::Position, Prop::Top,
    Prop::Right, Prop::Bottom, Prop::Left, Prop::BackgroundColor, Prop::Opacity, Prop::AlignContent,
    Prop::Color, Prop::FontSize, Prop::FontWeight, Prop::LineHeight, Prop::TextAlign, Prop::MaxLines, Prop::FontStyle, Prop::Overflow,
    Prop::BorderRadius, Prop::BorderWidth, Prop::BorderColor,
];

const WORDS: [&str; 8] = ["mail", "Mantou", "a much longer subject line", "", "wraps\nlines", "✓", "Inbox (3)", "the quick brown fox jumps"];

pub const VIEWPORTS: [(u32, u32, f32); 4] = [(400, 300, 1.0), (800, 600, 1.0), (600, 450, 1.5), (1000, 700, 2.0)];

pub fn prop(src: &mut impl Source) -> Prop {
    // `display: none` hides whole subtrees; keep it rarer than the rest.
    loop {
        let p = PROPS[src.below(PROPS.len() as u32) as usize];
        if p != Prop::Display || src.chance(20) {
            return p;
        }
    }
}

pub fn value(p: Prop, src: &mut impl Source) -> Value {
    use mantou_tree::protocol::ValueKind;
    match p.kind() {
        ValueKind::F32 if p == Prop::Opacity => Value::F32(src.below(5) as f32 * 0.25),
        ValueKind::F32 if p == Prop::FontSize => Value::F32(8.0 + src.below(6) as f32 * 4.0),
        ValueKind::F32 if p == Prop::FontWeight => Value::F32(100.0 * (1 + src.below(9)) as f32),
        ValueKind::F32 if p == Prop::MaxLines => Value::F32(src.below(4) as f32),
        ValueKind::F32 if p == Prop::LineHeight => Value::F32(src.below(4) as f32 * 0.5),
        ValueKind::F32 if p == Prop::BorderRadius || p == Prop::BorderWidth => Value::F32(src.below(5) as f32 * 2.0),
        ValueKind::F32 => Value::F32(src.below(7) as f32 * 0.5),
        ValueKind::Color => {
            const PALETTE: [u32; 5] = [0, 0xff_00_00_ff, 0xff_ff_80_00, 0x80_20_40_60, 0xff_ff_ff_ff];
            Value::Color(PALETTE[src.below(5) as usize])
        }
        ValueKind::Length => Value::Length(match src.below(4) {
            0 | 1 => Length::Px(src.below(41) as f32 * 5.0 + src.below(4) as f32 * 0.25),
            2 => Length::Percent(src.below(11) as f32 * 10.0),
            _ => Length::Auto,
        }),
        ValueKind::Enum(n) => Value::Enum(src.below(n)),
        // Families other than the default need a FONT_FAMILY first; the model keeps to it.
        ValueKind::Family => Value::Family(0),
    }
}

#[derive(Clone, Debug, Default)]
pub struct MNode {
    pub text: Option<String>,
    pub parent: Option<u32>,
    pub children: Vec<u32>,
    pub own: BTreeMap<Prop, Value>,
    pub shared: u32,
    pub listen: u32,
}

/// The state a sequence of valid mutations should produce.
#[derive(Clone, Debug)]
pub struct Model {
    pub nodes: BTreeMap<u32, MNode>,
    pub styles: BTreeMap<u32, Vec<(Prop, Value)>>,
    pub root: Option<u32>,
    pub viewport: (u32, u32, f32),
    next_id: u32,
    freed: Vec<u32>,
}

impl Default for Model {
    fn default() -> Self {
        Self::new()
    }
}

impl Model {
    pub fn new() -> Model {
        Model { nodes: BTreeMap::new(), styles: BTreeMap::new(), root: None, viewport: VIEWPORTS[0], next_id: 1, freed: Vec::new() }
    }

    fn pick(&self, src: &mut impl Source) -> Option<u32> {
        if self.nodes.is_empty() {
            return None;
        }
        let i = src.below(self.nodes.len() as u32) as usize;
        self.nodes.keys().nth(i).copied()
    }

    fn is_ancestor(&self, a: u32, of: u32) -> bool {
        let mut x = Some(of);
        while let Some(n) = x {
            if n == a {
                return true;
            }
            x = self.nodes[&n].parent;
        }
        false
    }

    fn detach(&mut self, id: u32) {
        if let Some(p) = self.nodes.get_mut(&id).and_then(|n| n.parent.take()) {
            self.nodes.get_mut(&p).unwrap().children.retain(|&c| c != id);
        }
    }

    /// Creates a root with a few children, so trees start non-trivial.
    pub fn seed_tree(&mut self, ops: &mut Ops, src: &mut impl Source) {
        let root = self.create(ops);
        ops.set_root(root);
        self.root = Some(root);
        for _ in 0..1 + src.below(4) {
            let c = self.create(ops);
            self.nodes.get_mut(&root).unwrap().children.push(c);
            self.nodes.get_mut(&c).unwrap().parent = Some(root);
            ops.insert(root, c, 0);
        }
    }

    fn create(&mut self, ops: &mut Ops) -> u32 {
        let id = self.freed.pop().unwrap_or_else(|| {
            self.next_id += 1;
            self.next_id - 1
        });
        self.nodes.insert(id, MNode::default());
        ops.create(id);
        id
    }

    fn create_text(&mut self, ops: &mut Ops, src: &mut impl Source) -> u32 {
        let id = self.freed.pop().unwrap_or_else(|| {
            self.next_id += 1;
            self.next_id - 1
        });
        let text = WORDS[src.below(WORDS.len() as u32) as usize].to_owned();
        ops.create_text(id).text(id, &text);
        self.nodes.insert(id, MNode { text: Some(text), ..MNode::default() });
        id
    }

    /// A node that can hold children (text nodes can't).
    fn pick_parent(&self, src: &mut impl Source) -> Option<u32> {
        self.pick(src).filter(|id| self.nodes[id].text.is_none())
    }

    /// One random valid mutation, applied to the model and recorded in `ops`.
    /// Returns a new viewport when the mutation is a resize instead of an op.
    pub fn mutate(&mut self, ops: &mut Ops, src: &mut impl Source) -> Option<(u32, u32, f32)> {
        match src.below(100) {
            0..=17 => {
                // Create, often inserting it at once, as UIs do.
                let id = if src.chance(35) { self.create_text(ops, src) } else { self.create(ops) };
                if let Some(parent) = self.pick_parent(src).filter(|&p| p != id)
                    && src.chance(80)
                {
                    self.insert(ops, parent, id, src);
                }
            }
            18..=32 => {
                if let (Some(parent), Some(child)) = (self.pick_parent(src), self.pick(src))
                    && parent != child
                    && !self.is_ancestor(child, parent)
                {
                    self.insert(ops, parent, child, src);
                }
            }
            33..=39 => {
                if let Some(child) = self.pick(src)
                    && let Some(parent) = self.nodes[&child].parent
                {
                    self.detach(child);
                    ops.remove(parent, child);
                }
            }
            40..=45 => {
                if let Some(id) = self.pick(src).filter(|&id| Some(id) != self.root || src.chance(10)) {
                    self.detach(id);
                    let n = self.nodes.remove(&id).unwrap();
                    for c in n.children {
                        self.nodes.get_mut(&c).unwrap().parent = None;
                    }
                    if self.root == Some(id) {
                        self.root = None;
                    }
                    self.freed.push(id);
                    ops.release(id);
                }
            }
            46..=72 => {
                if let Some(id) = self.pick(src) {
                    let p = prop(src);
                    let v = value(p, src);
                    self.nodes.get_mut(&id).unwrap().own.insert(p, v);
                    ops.style(id, p, v);
                }
            }
            73..=78 => {
                if let Some(id) = self.pick(src) {
                    let p = prop(src);
                    self.nodes.get_mut(&id).unwrap().own.remove(&p);
                    ops.style_reset(id, p);
                }
            }
            79..=84 => {
                let sid = 1 + src.below(4);
                let props: Vec<(Prop, Value)> = (0..src.below(5)).map(|_| {
                    let p = prop(src);
                    (p, value(p, src))
                }).collect();
                ops.style_def(sid, &props);
                self.styles.insert(sid, props);
            }
            85..=89 => {
                if let Some(id) = self.pick(src) {
                    let sid = src.below(5);
                    if sid == 0 || self.styles.contains_key(&sid) {
                        self.nodes.get_mut(&id).unwrap().shared = sid;
                        ops.style_use(id, sid);
                    }
                }
            }
            90 => {
                if let Some(id) = self.pick(src).filter(|id| self.nodes[id].text.is_some()) {
                    let text = WORDS[src.below(WORDS.len() as u32) as usize].to_owned();
                    ops.text(id, &text);
                    self.nodes.get_mut(&id).unwrap().text = Some(text);
                }
            }
            91..=93 => {
                if let Some(id) = self.pick(src) {
                    let mask = src.below(2);
                    self.nodes.get_mut(&id).unwrap().listen = mask;
                    ops.listen(id, mask);
                }
            }
            94..=95 => {
                let id = if src.chance(85) { self.pick(src) } else { None };
                self.root = id;
                ops.set_root(id.unwrap_or(0));
            }
            _ => {
                self.viewport = VIEWPORTS[src.below(VIEWPORTS.len() as u32) as usize];
                return Some(self.viewport);
            }
        }
        None
    }

    fn insert(&mut self, ops: &mut Ops, parent: u32, child: u32, src: &mut impl Source) {
        let siblings: Vec<u32> = self.nodes[&parent].children.iter().copied().filter(|&c| c != child).collect();
        let before = if siblings.is_empty() || src.chance(40) { 0 } else { siblings[src.below(siblings.len() as u32) as usize] };
        self.detach(child);
        let kids = &mut self.nodes.get_mut(&parent).unwrap().children;
        let at = if before == 0 { kids.len() } else { kids.iter().position(|&c| c == before).unwrap() };
        kids.insert(at, child);
        self.nodes.get_mut(&child).unwrap().parent = Some(parent);
        ops.insert(parent, child, before);
    }

    /// A batch that builds the model's state from nothing.
    pub fn rebuild(&self) -> Vec<u8> {
        let mut ops = Ops::new();
        for (&id, n) in &self.nodes {
            match &n.text {
                Some(t) => {
                    ops.create_text(id).text(id, t);
                }
                None => {
                    ops.create(id);
                }
            }
        }
        for (&sid, props) in &self.styles {
            ops.style_def(sid, props);
        }
        for (&id, n) in &self.nodes {
            for (&p, &v) in &n.own {
                ops.style(id, p, v);
            }
            if n.shared != 0 {
                ops.style_use(id, n.shared);
            }
            if n.listen != 0 {
                ops.listen(id, n.listen);
            }
        }
        for (&id, n) in &self.nodes {
            for &c in &n.children {
                ops.insert(id, c, 0);
            }
        }
        if let Some(r) = self.root {
            ops.set_root(r);
        }
        ops.take()
    }
}
