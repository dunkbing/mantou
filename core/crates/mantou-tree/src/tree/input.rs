//! Input nodes (design §8.3): an editor per node, the keyboard focus, and
//! what keys, the pointer and the IME do to the focused input. Events for JS
//! (focus, blur, text changes, submit) queue up in the tree; the FFI crate
//! takes them after each call. Platform services come in through traits: the
//! clipboard here, and the key bindings' platform (`set_mac_keys`).

use std::cell::RefCell;
use std::collections::HashMap;

use mantou_text::{Editor, TextEngine, TextStyle};

use super::{Tree, TreeEvent};
use crate::protocol::{focus_scope_flag, input_flag, key_modifier as m, named_key as k};

/// Width of an input that nothing sizes (logical px), like a browser's.
pub(super) const DEFAULT_WIDTH: f32 = 200.0;

pub(super) struct Input {
    /// A RefCell so that Taffy's measure function, which sees nodes shared, can lay it out.
    pub(super) editor: RefCell<Editor>,
    pub(super) placeholder: String,
    /// Counts the user's edits; VALUE ops older than this are stale.
    pub(super) rev: u32,
    /// The selection the app last heard (UTF-16), for SELECTION events.
    pub(super) reported_sel: Option<(usize, usize)>,
}

impl Input {
    pub(super) fn new(engine: &mut TextEngine) -> Input {
        let mut editor = Editor::new(&TextStyle::default());
        editor.set_text(engine, "");
        Input { editor: RefCell::new(editor), placeholder: String::new(), rev: 0, reported_sel: None }
    }

    pub(super) fn set_options(&mut self, engine: &mut TextEngine, flags: u32, max_length: u32) -> bool {
        let ed = self.editor.get_mut();
        ed.set_secure(engine, flags & input_flag::SECURE != 0);
        let multiline = flags & input_flag::MULTILINE != 0;
        let changed = ed.multiline != multiline;
        ed.set_multiline(multiline);
        ed.read_only = flags & input_flag::READ_ONLY != 0;
        ed.max_len = max_length as usize;
        changed
    }
}

/// The system clipboard, or a stand-in for tests.
pub trait Clipboard {
    fn get(&mut self) -> Option<String>;
    fn set(&mut self, text: &str);
}

/// A clipboard that lives in memory (headless instances, and windows without a system one).
#[derive(Clone, Debug, Default)]
pub struct MemoryClipboard(pub String);

impl Clipboard for MemoryClipboard {
    fn get(&mut self) -> Option<String> {
        (!self.0.is_empty()).then(|| self.0.clone())
    }
    fn set(&mut self, text: &str) {
        text.clone_into(&mut self.0);
    }
}

/// Where an input's text starts, in window px: single-line text is centred
/// vertically in the content box, as in a browser.
/// Where an input's text starts (window px), in its content box drawn at scale `k`.
pub(super) fn origin(ed: &Editor, engine: &mut TextEngine, content: [f32; 4], k: f32) -> (f32, f32) {
    if ed.multiline {
        return (content[0], content[1]);
    }
    let lh = ed.line_height(engine) * k;
    (content[0], content[1] + ((content[3] - content[1]) - lh).max(0.0) / 2.0)
}

/// Makes a text selection's editor show `node`'s text in its box (logical px at scale `k`).
pub(super) fn sync_selection(ed: &mut Editor, engine: &mut TextEngine, node: &super::Node, content: [f32; 4], k: f32) {
    ed.read_only = true;
    ed.set_multiline(true);
    ed.set_style(engine, &node.v.text);
    ed.set_size(((content[2] - content[0]) / k).max(0.0), ((content[3] - content[1]) / k).max(0.0));
    if ed.text() != node.text {
        ed.set_text(engine, &node.text);
    }
}

/// A selection in static text: one editor per Text node it touches, from the node the press began in
/// (at `anchor_u16`, UTF-16 units) to the node the pointer is in.
pub(super) struct TextSel {
    /// The topmost `userSelect: "text"` ancestor (or the text itself): the selection stays inside it.
    pub root: u32,
    pub editors: HashMap<u32, Editor>,
    pub anchor: u32,
    pub anchor_u16: usize,
}

impl Tree {
    /// Whether some static text is selected (it takes Copy and Select All).
    pub fn has_text_selection(&self) -> bool {
        self.tsel.is_some()
    }

    /// The topmost node at or above `id` that has `userSelect: "text"`, if any: a View with it makes all the
    /// Text inside selectable, as one selection.
    fn selection_root(&self, id: u32) -> Option<u32> {
        let mut root = None;
        let mut a = Some(id);
        while let Some(n) = a {
            if self.nodes[&n].v.user_select {
                root = Some(n);
            }
            a = self.nodes[&n].parent;
        }
        root
    }

    /// The Text nodes inside `root`, laid out, in tree order.
    fn selectable_texts(&self, root: u32) -> Vec<u32> {
        self.boxes.iter().map(|b| b.id).filter(|&id| self.nodes[&id].kind == crate::protocol::node_kind::TEXT && self.is_inside(id, root)).collect()
    }

    fn text_box(&self, id: u32) -> Option<([f32; 4], f32)> {
        self.boxes.iter().find(|b| b.id == id).map(|b| (b.content, b.k))
    }

    /// The primary button went down off the inputs: on selectable text, place the caret (a word on
    /// 2 clicks, a line on 3; shift extends); elsewhere, drop the text selection. Returns whether the scene changed.
    fn text_select_down(&mut self, x: f32, y: f32, clicks: u32, extend: bool) -> bool {
        let hit = self.hit(x, y).filter(|id| self.nodes[id].kind == crate::protocol::node_kind::TEXT);
        let Some((id, root)) = hit.and_then(|id| self.selection_root(id).map(|r| (id, r))) else {
            return self.tsel.take().is_some();
        };
        let Some((content, k)) = self.text_box(id) else { return false };
        if extend && self.tsel.as_ref().is_some_and(|t| t.root == root) {
            self.drag = Some(self.tsel.as_ref().expect("checked").anchor);
            self.extend_text_selection(x, y);
            return true;
        }
        let Some(engine) = self.text.as_mut() else { return false };
        let mut ed = Editor::new(&self.nodes[&id].v.text);
        sync_selection(&mut ed, engine, &self.nodes[&id], content, k);
        let (px, py) = ((x - content[0]) / k, (y - content[1]) / k);
        match clicks {
            0 | 1 => ed.move_to_point(engine, px, py),
            2 => ed.select_word_at(engine, px, py),
            _ => ed.select_line_at(engine, px, py),
        }
        let anchor_u16 = ed.selection_utf16().0;
        self.tsel = Some(TextSel { root, editors: HashMap::from([(id, ed)]), anchor: id, anchor_u16 });
        self.drag = Some(id);
        self.scene_dirty = true;
        true
    }

    /// The pointer is at (x, y) with a text selection in progress: moves its end there. The Text under the
    /// pointer (or the nearest one, above or below) takes the end; the Texts between it and the start are selected whole.
    fn extend_text_selection(&mut self, x: f32, y: f32) -> bool {
        let Some(ts) = self.tsel.as_ref() else { return false };
        let (root, anchor, anchor_u16) = (ts.root, ts.anchor, ts.anchor_u16);
        let texts = self.selectable_texts(root);
        let Some(ai) = texts.iter().position(|&t| t == anchor) else { return false };
        // The Text the pointer is in, else the one nearest to it.
        let dist = |id: u32| {
            let r = self.boxes.iter().find(|b| b.id == id).map_or([0.0; 4], |b| b.content);
            let (dx, dy) = ((r[0] - x).max(x - r[2]).max(0.0), (r[1] - y).max(y - r[3]).max(0.0));
            dy * 1000.0 + dx // a line above or below wins over one that is only closer sideways
        };
        let Some(ti) = (0..texts.len()).min_by(|&a, &b| dist(texts[a]).total_cmp(&dist(texts[b]))) else { return false };
        let (lo, hi) = (ai.min(ti), ai.max(ti));
        let Some(engine) = self.text.as_mut() else { return false };
        let ts = self.tsel.as_mut().expect("checked");
        ts.editors.retain(|id, _| texts[lo..=hi].contains(id));
        for (n, &id) in texts.iter().enumerate().take(hi + 1).skip(lo) {
            let Some(b) = self.boxes.iter().find(|b| b.id == id) else { continue };
            let (content, k) = (b.content, b.k);
            let node = &self.nodes[&id];
            let ed = ts.editors.entry(id).or_insert_with(|| Editor::new(&node.v.text));
            sync_selection(ed, engine, node, content, k);
            let len = ed.text().encode_utf16().count();
            if ai == ti {
                ed.select_utf16(engine, anchor_u16, anchor_u16);
                ed.extend_to_point(engine, (x - content[0]) / k, (y - content[1]) / k);
            } else if n == ai {
                ed.select_utf16(engine, anchor_u16, if ti > ai { len } else { 0 });
            } else if n == ti {
                ed.move_to_point(engine, (x - content[0]) / k, (y - content[1]) / k);
                let caret = ed.selection_utf16().1;
                ed.select_utf16(engine, if ti > ai { 0 } else { len }, caret);
            } else {
                ed.select_utf16(engine, 0, len);
            }
        }
        self.scene_dirty = true;
        true
    }

    /// Copy and Select All on selected static text.
    fn text_selection_key(&mut self, key: u32, mods: u32, clipboard: &mut dyn Clipboard) -> bool {
        let primary = if self.mac { mods & m::META != 0 } else { mods & m::CONTROL != 0 };
        if !primary || mods & m::ALT != 0 {
            return false;
        }
        let Some(root) = self.tsel.as_ref().map(|t| t.root) else { return false };
        let texts = self.selectable_texts(root);
        match char::from_u32(key).map(|c| c.to_ascii_lowercase()) {
            Some('c') => {
                // The selected parts, one per Text, a line apart.
                let ts = self.tsel.as_ref().expect("checked");
                let parts: Vec<String> = texts.iter().filter_map(|id| ts.editors.get(id)?.selected_text()).collect();
                if !parts.is_empty() {
                    clipboard.set(&parts.join("\n"));
                }
                true
            }
            Some('a') => {
                let Some(engine) = self.text.as_mut() else { return false };
                let ts = self.tsel.as_mut().expect("checked");
                ts.editors.clear();
                for &id in &texts {
                    let Some(b) = self.boxes.iter().find(|b| b.id == id) else { continue };
                    let (content, k) = (b.content, b.k);
                    let node = &self.nodes[&id];
                    let mut ed = Editor::new(&node.v.text);
                    sync_selection(&mut ed, engine, node, content, k);
                    let len = ed.text().encode_utf16().count();
                    ed.select_utf16(engine, 0, len);
                    ts.editors.insert(id, ed);
                }
                if let Some(&first) = texts.first() {
                    ts.anchor = first;
                    ts.anchor_u16 = 0;
                }
                self.scene_dirty = true;
                true
            }
            _ => false,
        }
    }

    /// Key bindings: macOS (Command for shortcuts, Option for words) or the others (Control for both).
    pub fn set_mac_keys(&mut self, mac: bool) {
        self.mac = mac;
    }

    /// The focused input.
    pub fn focused(&self) -> Option<u32> {
        self.focus
    }

    /// Whether the focused input is secure (the window then tells the OS it's a password field).
    pub fn focused_is_secure(&self) -> bool {
        self.focus.and_then(|id| self.nodes.get(&id)?.input.as_ref()).is_some_and(|i| i.editor.borrow().is_secure())
    }

    /// An input's text (for tests and debugging).
    pub fn value_of(&self, id: u32) -> Option<String> {
        self.nodes.get(&id)?.input.as_ref().map(|i| i.editor.borrow().text())
    }

    /// Moves the focus, queueing BLUR then FOCUS. Ids that can't take the focus blur.
    pub(super) fn set_focus(&mut self, id: Option<u32>) {
        let id = id.filter(|id| self.nodes.get(id).is_some_and(|n| self.can_focus(n)));
        if id == self.focus {
            return;
        }
        self.scene_dirty = true;
        if let Some(old) = self.focus.take() {
            if let (Some(inp), Some(text)) = (self.nodes.get(&old).and_then(|n| n.input.as_ref()), self.text.as_mut()) {
                inp.editor.borrow_mut().set_compose(text, "", None);
            }
            self.events.push(TreeEvent::Blur(old));
        }
        if let Some(new) = id {
            self.focus = Some(new);
            self.events.push(TreeEvent::Focus(new));
        }
    }

    /// Runs `f` on the focused input's editor. `edit`: it may change the
    /// text (a TEXT_CHANGED follows if it did, and a multiline input is laid
    /// out again). Returns false when nothing is focused.
    fn with_focused(&mut self, edit: bool, f: impl FnOnce(&mut Editor, &mut TextEngine)) -> bool {
        let Some(id) = self.focus else { return false };
        self.scene_dirty = true; // the caret or selection may move, if not the text
        let (Some(node), Some(text)) = (self.nodes.get_mut(&id), self.text.as_mut()) else { return false };
        let Some(inp) = node.input.as_mut() else { return false };
        let ed = inp.editor.get_mut();
        let before = edit.then(|| ed.text());
        f(ed, text);
        if let Some(before) = before {
            let after = ed.text();
            if ed.multiline {
                let _ = self.taffy.mark_dirty(node.taffy);
                self.layout_dirty = true;
            }
            if after != before {
                inp.rev += 1;
                self.events.push(TreeEvent::Changed { id, rev: inp.rev, text: after });
            }
        }
        true
    }

    /// An input's text origin (window px) and the scale it's drawn at.
    fn origin_of(&mut self, id: u32) -> Option<(f32, f32, f32)> {
        let b = self.boxes.iter().find(|b| b.id == id)?;
        let (content, k) = (b.content, b.k);
        let ed = self.nodes.get(&id)?.input.as_ref()?.editor.borrow();
        let (x, y) = origin(&ed, self.text.as_mut()?, content, k);
        Some((x, y, k))
    }

    /// The primary button went down at (x, y), the `clicks`th time in a row.
    /// On an input: focus it and place the caret (2 = select a word, 3 = the
    /// line; `extend` = shift-click). Elsewhere: blur. Returns whether
    /// anything changed.
    pub fn pointer_down(&mut self, x: f32, y: f32, clicks: u32, extend: bool) -> bool {
        if self.thumb_down(x, y) {
            return true; // dragging a scrollbar: the focus stays where it is
        }
        self.keyboard_mode = false;
        let had_ring = self.focus_visible;
        self.focus_visible = false;
        let focus = self.hit(x, y).and_then(|id| self.focus_target(id));
        let target = focus.filter(|id| self.nodes[id].input.is_some());
        let Some(id) = target else {
            // A focusable view takes the focus (no ring: it came from the pointer); elsewhere blurs.
            self.drag = None;
            let changed = self.focus != focus || had_ring;
            self.set_focus(focus);
            return self.text_select_down(x, y, clicks, extend) || changed;
        };
        self.tsel = None;
        let Some((ox, oy, k)) = self.origin_of(id) else { return false };
        self.set_focus(Some(id));
        let (px, py) = ((x - ox) / k, (y - oy) / k);
        self.with_focused(false, |ed, t| match clicks {
            0 | 1 if extend => ed.extend_to_point(t, px, py),
            0 | 1 => ed.move_to_point(t, px, py),
            2 => ed.select_word_at(t, px, py),
            _ => ed.select_line_at(t, px, py),
        });
        self.drag = Some(id);
        true
    }

    /// The pointer moved with the primary button down: extends the selection
    /// of the input the press started in.
    pub fn pointer_drag(&mut self, x: f32, y: f32) -> bool {
        if self.thumb_drag.is_some() {
            return self.thumb_move(x, y);
        }
        if self.drag.is_some_and(|d| self.tsel.as_ref().is_some_and(|t| t.anchor == d)) {
            return self.extend_text_selection(x, y);
        }
        let Some(id) = self.drag.filter(|&d| Some(d) == self.focus) else { return false };
        let Some((ox, oy, k)) = self.origin_of(id) else { return false };
        self.with_focused(false, |ed, t| ed.extend_to_point(t, (x - ox) / k, (y - oy) / k))
    }

    pub fn pointer_up(&mut self) {
        self.drag = None;
        self.thumb_up();
    }

    /// Whether `id` is `ancestor` or inside it.
    fn is_inside(&self, mut id: u32, ancestor: u32) -> bool {
        loop {
            if id == ancestor {
                return true;
            }
            match self.nodes.get(&id).and_then(|n| n.parent) {
                Some(p) => id = p,
                None => return false,
            }
        }
    }

    fn laid_out(&self, id: u32) -> bool {
        self.boxes.iter().any(|b| b.id == id)
    }

    /// What Tab moves through: inputs and focusable views (laid out and
    /// visible) inside the topmost trapping focus scope on screen, if there is
    /// one; those with an order first (1, 2…), then the rest in tree order.
    pub(super) fn tab_order(&self) -> Vec<u32> {
        let trap = self.boxes.iter().rev().map(|b| b.id).find(|id| self.nodes[id].scope & focus_scope_flag::TRAP != 0);
        let mut order: Vec<u32> = self
            .boxes
            .iter()
            .filter(|b| self.tabbable(&self.nodes[&b.id]) && trap.is_none_or(|s| self.is_inside(b.id, s)))
            .map(|b| b.id)
            .collect();
        order.dedup();
        order.sort_by_key(|id| match self.nodes[id].focusable.1 {
            0 => u32::MAX,
            n => n,
        });
        order
    }

    /// After a layout: scopes that appeared remember where the focus was;
    /// scopes that left the screen (released, detached, hidden, or no longer
    /// scopes) give it back, unless the user has put it somewhere else since.
    pub(super) fn update_scopes(&mut self) {
        let on_screen: Vec<u32> = self.boxes.iter().map(|b| b.id).filter(|id| self.nodes[id].scope != 0).collect();
        let gone: Vec<(u32, Option<u32>)> = self.scopes.iter().filter(|(s, _)| !on_screen.contains(s)).copied().collect();
        self.scopes.retain(|(s, _)| on_screen.contains(s));
        for (_, restore) in gone.into_iter().rev() {
            let lost = self.focus.is_none_or(|f| !self.laid_out(f));
            let target = restore.filter(|r| self.nodes.get(r).is_some_and(|n| self.can_focus(n)) && self.laid_out(*r));
            if lost && target.is_some() {
                self.set_focus(target);
            }
        }
        for s in on_screen {
            if self.scopes.iter().any(|(id, _)| *id == s) {
                continue;
            }
            let wants_restore = self.nodes[&s].scope & focus_scope_flag::RESTORE != 0;
            let before = match self.focus {
                Some(f) if self.is_inside(f, s) => self.focus_at_batch,
                f => f,
            };
            self.scopes.push((s, if wants_restore { before.filter(|b| !self.is_inside(*b, s)) } else { None }));
        }
    }

    pub(super) fn tab(&mut self, back: bool) {
        let order = self.tab_order();
        if order.is_empty() {
            return;
        }
        let at = self.focus.and_then(|f| order.iter().position(|&i| i == f));
        let next = match (at, back) {
            (None, false) => 0,
            (None, true) => order.len() - 1,
            (Some(i), false) => (i + 1) % order.len(),
            (Some(i), true) => (i + order.len() - 1) % order.len(),
        };
        self.set_focus(Some(order[next]));
        self.focus_visible = true;
        self.scene_dirty = true;
        self.with_focused(false, |ed, t| ed.navigate(t, |d| d.select_all()));
    }

    /// A key went down while an input may be focused. `text` is what the key
    /// types, if anything. Returns whether the input used the key; keys it
    /// doesn't use (Escape, shortcuts it doesn't know…) go on to the app.
    pub fn key(&mut self, key: u32, text: Option<&str>, mods: u32, clipboard: &mut dyn Clipboard) -> bool {
        self.keyboard_mode = true;
        let Some(id) = self.focus else {
            // Nothing focused: Tab starts at the first thing it can reach.
            if key == k::TAB && !self.tab_order().is_empty() {
                self.tab(mods & m::SHIFT != 0);
                return true;
            }
            return self.text_selection_key(key, mods, clipboard);
        };
        if self.nodes.get(&id).is_some_and(|n| n.input.is_none()) {
            return self.view_key(id, key, mods & m::SHIFT != 0);
        }
        let Some(inp) = self.nodes.get(&id).and_then(|n| n.input.as_ref()) else { return false };
        let (multiline, composing) = {
            let ed = inp.editor.borrow();
            (ed.multiline, ed.is_composing())
        };
        if composing {
            return true; // the IME has the keys until it commits
        }
        let (shift, ctrl, alt, meta) = (mods & m::SHIFT != 0, mods & m::CONTROL != 0, mods & m::ALT != 0, mods & m::META != 0);
        let mac = self.mac;
        let primary = if mac { meta } else { ctrl };
        let by_word = if mac { alt } else { ctrl };
        let by_line = mac && meta;
        match key {
            k::ARROW_LEFT | k::ARROW_RIGHT => {
                let left = key == k::ARROW_LEFT;
                self.with_focused(false, |ed, t| {
                    ed.navigate(t, |d| match (by_line, by_word, shift, left) {
                        (true, _, false, true) => d.move_to_line_start(),
                        (true, _, false, false) => d.move_to_line_end(),
                        (true, _, true, true) => d.select_to_line_start(),
                        (true, _, true, false) => d.select_to_line_end(),
                        (_, true, false, true) => d.move_word_left(),
                        (_, true, false, false) => d.move_word_right(),
                        (_, true, true, true) => d.select_word_left(),
                        (_, true, true, false) => d.select_word_right(),
                        (_, _, false, true) => d.move_left(),
                        (_, _, false, false) => d.move_right(),
                        (_, _, true, true) => d.select_left(),
                        (_, _, true, false) => d.select_right(),
                    })
                })
            }
            k::ARROW_UP | k::ARROW_DOWN if multiline => {
                let up = key == k::ARROW_UP;
                self.with_focused(false, |ed, t| {
                    ed.navigate(t, |d| match (by_line, shift, up) {
                        (true, false, true) => d.move_to_text_start(),
                        (true, false, false) => d.move_to_text_end(),
                        (true, true, true) => d.select_to_text_start(),
                        (true, true, false) => d.select_to_text_end(),
                        (false, false, true) => d.move_up(),
                        (false, false, false) => d.move_down(),
                        (false, true, true) => d.select_up(),
                        (false, true, false) => d.select_down(),
                    })
                })
            }
            k::HOME | k::END => {
                let home = key == k::HOME;
                let whole = ctrl || !multiline;
                self.with_focused(false, |ed, t| {
                    ed.navigate(t, |d| match (whole, shift, home) {
                        (true, false, true) => d.move_to_text_start(),
                        (true, false, false) => d.move_to_text_end(),
                        (true, true, true) => d.select_to_text_start(),
                        (true, true, false) => d.select_to_text_end(),
                        (false, false, true) => d.move_to_line_start(),
                        (false, false, false) => d.move_to_line_end(),
                        (false, true, true) => d.select_to_line_start(),
                        (false, true, false) => d.select_to_line_end(),
                    })
                })
            }
            k::BACKSPACE => self.with_focused(true, |ed, t| {
                if by_line {
                    ed.backspace_line(t);
                } else {
                    ed.backspace(t, by_word);
                }
            }),
            k::DELETE => self.with_focused(true, |ed, t| {
                ed.delete(t, by_word);
            }),
            k::ENTER => {
                if multiline && !primary {
                    self.with_focused(true, |ed, t| {
                        ed.insert(t, "\n");
                    })
                } else {
                    self.events.push(crate::tree::TreeEvent::Submit(id));
                    true
                }
            }
            k::TAB => {
                self.tab(shift);
                true
            }
            _ if primary && !alt => {
                let Some(c) = char::from_u32(key).map(|c| c.to_ascii_lowercase()) else { return false };
                match c {
                    'a' => self.with_focused(false, |ed, t| ed.navigate(t, |d| d.select_all())),
                    'c' => {
                        let sel = inp.editor.borrow().selected_text();
                        if let Some(s) = sel {
                            clipboard.set(&s);
                        }
                        true
                    }
                    'x' => self.with_focused(true, |ed, t| {
                        if let Some(s) = ed.cut(t) {
                            clipboard.set(&s);
                        }
                    }),
                    'v' => {
                        let Some(s) = clipboard.get() else { return true };
                        self.with_focused(true, |ed, t| {
                            ed.insert(t, &s);
                        })
                    }
                    'z' if shift => self.with_focused(true, |ed, t| {
                        ed.redo(t);
                    }),
                    'z' => self.with_focused(true, |ed, t| {
                        ed.undo(t);
                    }),
                    'y' if !mac => self.with_focused(true, |ed, t| {
                        ed.redo(t);
                    }),
                    _ => false,
                }
            }
            _ => {
                // Control on macOS is for the app (and Emacs-style bindings, not yet).
                if mac && ctrl {
                    return false;
                }
                let Some(t) = text.filter(|t| !t.is_empty() && !t.chars().any(char::is_control)) else { return false };
                let t = t.to_owned();
                self.with_focused(true, |ed, e| {
                    ed.insert(e, &t);
                })
            }
        }
    }

    /// Text from the IME or the platform, inserted at the caret (also how
    /// tests type a whole string at once).
    pub fn insert_text(&mut self, text: &str) -> bool {
        self.with_focused(true, |ed, t| {
            ed.commit(t, text);
        })
    }

    /// The IME's composition in progress; empty ends it. `cursor`: a byte range in `text`.
    pub fn ime_preedit(&mut self, text: &str, cursor: Option<(usize, usize)>) -> bool {
        self.with_focused(true, |ed, t| ed.set_compose(t, text, cursor))
    }

    /// Where the IME's candidate window should go: the caret of the focused
    /// input, in logical window px.
    pub fn ime_area(&mut self) -> Option<[f32; 4]> {
        let id = self.focus?;
        let (ox, oy, k) = self.origin_of(id)?;
        let mut ed = self.nodes.get(&id)?.input.as_ref()?.editor.borrow_mut();
        let r = ed.ime_area(self.text.as_mut()?);
        Some([ox + r[0] * k, oy + r[1] * k, ox + r[2] * k, oy + r[3] * k])
    }

    /// An input's selection (anchor, focus = the caret) in UTF-16 code units.
    pub fn selection_utf16(&self, id: u32) -> Option<(usize, usize)> {
        self.nodes.get(&id)?.input.as_ref().map(|i| i.editor.borrow().selection_utf16())
    }

    /// The focused input's selection as byte offsets (anchor, focus), for tests.
    pub fn selection_of(&self, id: u32) -> Option<(usize, usize)> {
        self.nodes.get(&id)?.input.as_ref().map(|i| i.editor.borrow().selection_range())
    }
}
