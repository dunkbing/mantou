//! Input nodes (design §8.3): an editor per node, the keyboard focus, and
//! what keys, the pointer and the IME do to the focused input. Events for JS
//! (focus, blur, text changes, submit) queue up in the tree; the FFI crate
//! takes them after each call. Platform services come in through traits: the
//! clipboard here, and the key bindings' platform (`set_mac_keys`).

use std::cell::RefCell;

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
}

impl Input {
    pub(super) fn new(engine: &mut TextEngine) -> Input {
        let mut editor = Editor::new(&TextStyle::default());
        editor.set_text(engine, "");
        Input { editor: RefCell::new(editor), placeholder: String::new(), rev: 0 }
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

impl Tree {
    /// Whether some static text is selected (it takes Copy and Select All).
    pub fn has_text_selection(&self) -> bool {
        self.tsel.is_some()
    }

    /// The primary button went down off the inputs: on selectable text, place the caret (a word on
    /// 2 clicks, a line on 3; shift extends); elsewhere, drop the text selection. Returns whether the scene changed.
    fn text_select_down(&mut self, x: f32, y: f32, clicks: u32, extend: bool) -> bool {
        let hit = self.hit(x, y).filter(|id| self.nodes[id].kind == crate::protocol::node_kind::TEXT && self.nodes[id].v.user_select);
        let Some(id) = hit else {
            return self.tsel.take().is_some();
        };
        let Some(b) = self.boxes.iter().find(|b| b.id == id) else { return false };
        let (content, k) = (b.content, b.k);
        let Some(engine) = self.text.as_mut() else { return false };
        if self.tsel.as_ref().is_none_or(|(s, _)| *s != id) {
            self.tsel = Some((id, Editor::new(&self.nodes[&id].v.text)));
        }
        let (_, ed) = self.tsel.as_mut().expect("just set");
        sync_selection(ed, engine, &self.nodes[&id], content, k);
        let (px, py) = ((x - content[0]) / k, (y - content[1]) / k);
        match clicks {
            0 | 1 if extend => ed.extend_to_point(engine, px, py),
            0 | 1 => ed.move_to_point(engine, px, py),
            2 => ed.select_word_at(engine, px, py),
            _ => ed.select_line_at(engine, px, py),
        }
        self.drag = Some(id);
        self.scene_dirty = true;
        true
    }

    /// Copy and Select All on selected static text.
    fn text_selection_key(&mut self, key: u32, mods: u32, clipboard: &mut dyn Clipboard) -> bool {
        let primary = if self.mac { mods & m::META != 0 } else { mods & m::CONTROL != 0 };
        if !primary || mods & m::ALT != 0 {
            return false;
        }
        let (Some((_, ed)), Some(engine)) = (self.tsel.as_mut(), self.text.as_mut()) else { return false };
        match char::from_u32(key).map(|c| c.to_ascii_lowercase()) {
            Some('c') => {
                if let Some(s) = ed.selected_text() {
                    clipboard.set(&s);
                }
                true
            }
            Some('a') => {
                ed.navigate(engine, |d| d.select_all());
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

    /// Moves the focus, queueing BLUR then FOCUS. Ids that aren't inputs blur.
    pub(super) fn set_focus(&mut self, id: Option<u32>) {
        let id = id.filter(|id| self.nodes.get(id).is_some_and(|n| n.input.is_some()));
        if id == self.focus {
            return;
        }
        self.scene_dirty = true;
        if let Some(old) = self.focus.take() {
            if let (Some(n), Some(text)) = (self.nodes.get(&old), self.text.as_mut()) {
                let mut ed = n.input.as_ref().expect("an input").editor.borrow_mut();
                ed.set_compose(text, "", None);
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
        let target = self.hit(x, y).filter(|id| self.nodes[id].input.is_some());
        let Some(id) = target else {
            self.drag = None;
            let had = self.focus.is_some();
            self.set_focus(None);
            return self.text_select_down(x, y, clicks, extend) || had;
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
        if let Some(sid) = self.drag.filter(|&d| self.tsel.as_ref().is_some_and(|(s, _)| *s == d)) {
            let Some(b) = self.boxes.iter().find(|b| b.id == sid) else { return false };
            let (content, k) = (b.content, b.k);
            let (Some((_, ed)), Some(engine)) = (self.tsel.as_mut(), self.text.as_mut()) else { return false };
            ed.extend_to_point(engine, (x - content[0]) / k, (y - content[1]) / k);
            self.scene_dirty = true;
            return true;
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

    /// The inputs Tab moves through, in tree order (laid out and visible):
    /// those inside the topmost trapping focus scope on screen, if there is one.
    fn tab_order(&self) -> Vec<u32> {
        let trap = self.boxes.iter().rev().map(|b| b.id).find(|id| self.nodes[id].scope & focus_scope_flag::TRAP != 0);
        self.boxes
            .iter()
            .filter(|b| self.nodes[&b.id].input.is_some() && trap.is_none_or(|s| self.is_inside(b.id, s)))
            .map(|b| b.id)
            .collect()
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
            let target = restore.filter(|r| self.nodes.get(r).is_some_and(|n| n.input.is_some()) && self.laid_out(*r));
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

    fn tab(&mut self, back: bool) {
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
        self.with_focused(false, |ed, t| ed.navigate(t, |d| d.select_all()));
    }

    /// A key went down while an input may be focused. `text` is what the key
    /// types, if anything. Returns whether the input used the key; keys it
    /// doesn't use (Escape, shortcuts it doesn't know…) go on to the app.
    pub fn key(&mut self, key: u32, text: Option<&str>, mods: u32, clipboard: &mut dyn Clipboard) -> bool {
        let Some(id) = self.focus else { return self.text_selection_key(key, mods, clipboard) };
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
