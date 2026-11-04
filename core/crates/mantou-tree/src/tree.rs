//! The shadow tree (design §5.1, §8): nodes created by the Worker's ops,
//! laid out with Taffy (text measured by mantou-text), turned into a scene of
//! quads (rectangles and glyphs), and hit-tested.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use mantou_text::{Align, AtlasImage, PlacedGlyph, TextEngine, TextLayout, TextStyle};

use taffy::prelude::*;
use taffy::style::{AlignContent, AlignItems, Dimension, LengthPercentage, LengthPercentageAuto};

use crate::decode::{DecodeError, Length, Op, Value, decode};
use crate::protocol::{self as p, Prop, event_mask};

pub mod access;
mod anim;
mod hover;
mod image;
mod input;
mod scroll;

use anim::Anims;
use input::Input;
use image::ImageNode;
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
}

/// Selections of inputs whose style doesn't set one: #3b82f666.
const SELECTION: u32 = 0x66f6823b;

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
    /// A scroll view's offset and limits (overflow: "scroll").
    scroll: Option<ScrollState>,
    /// An Image node's source.
    image: Option<Box<ImageNode>>,
    /// A Text node's layout at the width it was drawn at (its bits), reused
    /// while its text, style and width stay the same.
    drawn: RefCell<Option<(u32, Arc<TextLayout>)>>,
    /// Its transitions and running animations.
    anim: Option<Box<Anims>>,
    /// It has been placed at least once (a transition needs a look to start from).
    placed: bool,
}

/// A laid-out box in paint order: the node, its border box and content box
/// (logical px), and the clip its ancestors put on it (logical px).
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
}

pub struct Tree {
    taffy: TaffyTree<u32>,
    /// Created with the first text node.
    text: Option<TextEngine>,
    /// Decoded images by source (a path, or a hash of bytes), shared by the nodes that use them.
    image_cache: HashMap<String, std::sync::Weak<mantou_image::Image>>,
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
    /// The input with the keyboard focus.
    focus: Option<u32>,
    /// The input a press started in, while the button is down.
    drag: Option<u32>,
    events: Vec<TreeEvent>,
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
    animating: usize,
    /// Where the pointer is (logical px; None = outside the window), and the nodes under it, outermost first.
    pointer: Option<(f32, f32)>,
    hovered: Vec<u32>,
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
            focus: None,
            drag: None,
            events: Vec::new(),
            mac: cfg!(target_os = "macos"),
            reports_pending: false,
            scopes: Vec::new(),
            focus_at_batch: None,
            boxes_dirty: false,
            thumbs: Vec::new(),
            thumb_drag: None,
            requests: Vec::new(),
            scene_dirty: true,
            window_size: None,
            window_limits: None,
            now: 0.0,
            animating: 0,
            pointer: None,
            hovered: Vec::new(),
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
                    p::node_kind::IMAGE => self.taffy.new_leaf_with_context(Style::default(), id),
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
                    scroll: None,
                    image: (kind == p::node_kind::IMAGE).then(Box::default),
                    drawn: RefCell::new(None),
                    anim: None,
                    placed: false,
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
                if self.focus == Some(id) {
                    self.focus = None;
                }
                if self.drag == Some(id) {
                    self.drag = None;
                }
                self.hovered.retain(|&h| h != id); // gone: no event, there's no one to tell
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
            Op::Access { id, role, flags, label } => {
                self.node(id)?.access = (role != 0 || flags != 0 || !label.is_empty()).then_some(access::Access { role, flags, label });
            }
            Op::FocusScope { id, flags } => {
                self.node(id)?.scope = flags;
                self.layout_dirty = true; // scopes open and close at layout
            }
            Op::Focus { id } => {
                if id != 0 && self.node(id)?.input.is_none() {
                    return Err(format!("FOCUS: {id} is not an input"));
                }
                self.set_focus((id != 0).then_some(id));
            }
            Op::Transition { id, prop, duration, easing } => self.set_transition(id, prop, duration, easing)?,
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
        if matches!(self.node(parent)?.kind, p::node_kind::TEXT | p::node_kind::INPUT | p::node_kind::IMAGE) {
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
        let mut v = Visual { opacity: 1.0, scale: 1.0, color: 0xff_00_00_00, text: TextStyle::default(), ..Visual::default() };
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
        let node = self.nodes.get_mut(&id).expect("exists");
        if let (Some(inp), Some(engine)) = (node.input.as_mut(), self.text.as_ref()) {
            inp.editor.get_mut().set_style(engine, &v.text);
        }
        *node.drawn.get_mut() = None; // the text style may have changed
        if v.scrolls != node.scroll.is_some() {
            node.scroll = v.scrolls.then(ScrollState::default);
        }
        let (before, drawn_before) = (node.v, node.vis());
        node.v = v;
        self.layout_dirty = true;
        self.start_transitions(id, before, drawn_before);
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
            self.boxes.clear();
            self.update_hover();
            return true;
        };
        let (vw, vh) = self.viewport_logical();
        let rt = self.nodes[&root].taffy;
        let space = Size { width: AvailableSpace::Definite(vw), height: AvailableSpace::Definite(vh) };
        let (nodes, mut text) = (&self.nodes, self.text.as_mut());
        let measured = self.taffy.compute_layout_with_measure(rt, space, |inputs, _, ctx, style| {
            taffy::compute_leaf_layout(inputs, style, |_, _| 0.0, |known, avail| {
                let Some(node) = ctx.and_then(|id| nodes.get(id)) else { return Size::ZERO };
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
                    let height = known.height.unwrap_or_else(|| inp.editor.borrow_mut().measure_height(text, width).ceil());
                    return Size { width, height };
                }
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
        self.place();
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
        self.boxes.clear();
        self.thumbs.clear();
        if let Some(root) = self.root {
            self.collect_boxes(root, 0.0, 0.0, [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY], Xf { k: 1.0, o: [0.0; 2] });
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
        std::mem::take(&mut self.events)
    }

    /// Places a node and its subtree. `px, py` is its parent's origin in
    /// layout coordinates (scroll offsets applied); `xf` maps layout
    /// coordinates to the window's, with the ancestors' transforms.
    fn collect_boxes(&mut self, id: u32, px: f32, py: f32, clip: [f32; 4], xf: Xf) {
        let node = &self.nodes[&id];
        if node.v.hidden {
            return;
        }
        let Ok(l) = self.taffy.layout(node.taffy) else { return };
        let (x, y) = (px + l.location.x, py + l.location.y);
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
        let laid = LaidOut { id, rect: xf.rect(rect), content: xf.rect(content), clip, layout: rect, k: xf.k };
        self.boxes.push(laid);
        self.nodes.get_mut(&id).expect("exists").placed = true;
        let node = &self.nodes[&id];
        let inner = if node.v.clips { intersect(clip, laid.rect) } else { clip };
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
        for c in node.children.clone() {
            self.collect_boxes(c, x - offset[0], y - offset[1], inner, xf);
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
        let mut quads = Vec::new();
        let rgba = |c: u32, alpha: f32| {
            let ch = |shift: u32| ((c >> shift) & 255) as f32 / 255.0;
            [ch(0), ch(8), ch(16), ch(24) * alpha]
        };
        let mut glyphs = false;
        let mut images: HashMap<u32, Arc<Pixels>> = HashMap::new();
        let thumb_quad = |t: &Thumb, nodes: &HashMap<u32, Node>| {
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
            }
        };
        let mut thumbs = self.thumbs.iter().peekable();
        for (i, b) in self.boxes.iter().enumerate() {
            // A scroll view's thumb goes over its content, before whatever comes after it.
            while let Some(t) = thumbs.next_if(|t| t.at <= i) {
                quads.push(thumb_quad(t, &self.nodes));
            }
            let node = &self.nodes[&b.id];
            // What's drawn now: the style, with animated values over it.
            let v = node.vis();
            let k = b.k;
            let mut alpha = v.opacity;
            let mut a = node.parent;
            while let Some(pid) = a {
                let pn = &self.nodes[&pid];
                alpha *= pn.vis().opacity;
                a = pn.parent;
            }
            let clip = if b.clip[0].is_finite() { [snap(b.clip[0]), snap(b.clip[1]), snap(b.clip[2]), snap(b.clip[3])] } else { NO_CLIP };
            if clip[2] <= clip[0] || clip[3] <= clip[1] {
                continue; // clipped away entirely
            }
            let r = b.rect;
            let bg = rgba(v.background, alpha);
            let border_color = rgba(v.border_color, alpha);
            let border = if border_color[3] > 0.0 { (v.border * k * s).max(0.0) } else { 0.0 };
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
                    quads.push(Quad { rect: shape, color: sc, uv: [0.0; 4], clip, radius, border: 0.0, border_color: [0.0; 4], shadow: Some(sigma), image: None });
                }
            }
            if (bg[3] > 0.0 || border > 0.0) && rect[2] > rect[0] && rect[3] > rect[1] && overlaps(rect, clip) {
                quads.push(Quad { rect, color: bg, uv: [0.0; 4], clip, radius: v.radius * k * s, border, border_color, shadow: None, image: None });
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
                        quads.push(Quad { rect, color, uv, clip, radius: v.radius * k * s, border: 0.0, border_color: [0.0; 4], shadow: None, image: Some(ImageRef { id: px.id, tint }) });
                        images.insert(px.id, px);
                    }
                }
            }
            if node.kind == p::node_kind::TEXT && !node.text.is_empty() {
                let color = rgba(v.color, alpha);
                if color[3] <= 0.0 {
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
                        let l = text.layout(&node.text, &node.v.text, Some(width));
                        *drawn = Some((width.to_bits(), l.clone()));
                        l
                    }
                };
                glyphs |= push_glyphs(&mut quads, text, &layout.glyphs, (c[0], c[1]), k, s, color, clip);
                for d in &layout.decorations {
                    let rect = [snap((c[0] + d[0] * k) * s), snap((c[1] + d[1] * k) * s), snap((c[0] + d[2] * k) * s), snap((c[1] + d[3] * k) * s).max(snap((c[1] + d[1] * k) * s) + 1.0)];
                    if overlaps(rect, clip) {
                        quads.push(Quad { rect, color, uv: [0.0; 4], clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None });
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
                };
                if ed.text().is_empty() && !ed.is_composing() && !inp.placeholder.is_empty() {
                    let pc = v.placeholder_color.map_or([color[0], color[1], color[2], color[3] * 0.4], |p| rgba(p, alpha));
                    let style = TextStyle { max_lines: if ed.multiline { 0 } else { 1 }, ..v.text };
                    let layout = text.layout(&inp.placeholder, &style, ed.multiline.then_some(((c[2] - c[0]) / k).max(0.0)));
                    glyphs |= push_glyphs(&mut quads, text, &layout.glyphs, (ox, oy), k, s, pc, clip);
                }
                if focused {
                    let sel = rgba(v.selection_color.unwrap_or(SELECTION), alpha);
                    quads.extend(ed.selection(text).into_iter().map(|r| fill(r, sel)));
                }
                let placed = ed.glyphs(text);
                glyphs |= push_glyphs(&mut quads, text, &placed, (ox, oy), k, s, color, clip);
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
        for t in thumbs {
            quads.push(thumb_quad(t, &self.nodes));
        }
        let atlas = if glyphs { self.text.as_ref().map(|t| t.atlas()) } else { None };
        Scene { clear: self.clear, quads, size_px: self.viewport_px, atlas, images }
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
        self.listener_target(x, y, event_mask::PRESS)
    }

    /// The topmost node under a point, if a node on its path to the root listens for `mask` (an `event_mask` bit).
    pub fn listener_target(&self, x: f32, y: f32, mask: u32) -> Option<u32> {
        if self.on_thumb(x, y) {
            return None; // a scrollbar thumb is the core's, not the content's
        }
        let hit = self.hit(x, y)?;
        let mut a = Some(hit);
        while let Some(id) = a {
            let n = &self.nodes[&id];
            if n.listen & mask != 0 {
                return Some(hit);
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
    pub fn scale(&self) -> f32 {
        self.scale
    }
}

/// Glyph quads for text laid out from `origin` (window px) and drawn at scale
/// `k` (a transform's), on a display of scale `s`; returns whether any was drawn.
#[allow(clippy::too_many_arguments)]
fn push_glyphs(quads: &mut Vec<Quad>, text: &mut TextEngine, glyphs: &[PlacedGlyph], origin: (f32, f32), k: f32, s: f32, color: [f32; 4], clip: [f32; 4]) -> bool {
    let mut any = false;
    for g in glyphs {
        let (gx, gy) = ((origin.0 + g.x * k) * s, (origin.1 + g.y * k) * s);
        let size = g.size * k * s;
        if size < 0.5 {
            continue; // too small to see (a scale near 0)
        }
        let Some(e) = text.glyph(g.font, g.id, size, gx - gx.floor()) else { continue };
        let x0 = gx.floor() + e.left as f32;
        let y0 = gy.round() - e.top as f32;
        let rect = [x0, y0, x0 + e.w as f32, y0 + e.h as f32];
        if !overlaps(rect, clip) {
            continue;
        }
        let uv = [e.x as f32, e.y as f32, (e.x + e.w) as f32, (e.y + e.h) as f32];
        quads.push(Quad { rect, color, uv, clip, radius: 0.0, border: 0.0, border_color: [0.0; 4], shadow: None, image: None });
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
                v.color = c;
                v.color_set = true;
            }
        }
        Prop::ObjectFit => v.fit = e,
        Prop::Cursor => v.cursor = e,
        Prop::TranslateX => v.translate[0] = finite(num(), 0.0),
        Prop::TranslateY => v.translate[1] = finite(num(), 0.0),
        Prop::Scale => v.scale = finite(num(), 1.0).max(0.0),
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
