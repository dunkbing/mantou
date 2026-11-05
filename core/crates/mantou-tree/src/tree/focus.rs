//! Focusable views (dunkbing/mantou#17): views that take the keyboard focus
//! like inputs do. Tab reaches them, a press focuses them, Enter and Space
//! press them, and a focused scroll view (or a view in one) scrolls with the
//! keys, in the core, like the wheel. The core draws a ring around a focused
//! view when the focus came from the keyboard (`:focus-visible`).

use super::{Node, Tree, TreeEvent};
use crate::protocol::{event_mask, focusable_flag, named_key as k};

/// How far an arrow key scrolls (logical px), and the share of the view a page is.
const LINE: f32 = 40.0;
const PAGE: f32 = 0.9;

impl Tree {
    /// Whether a node can take the keyboard focus: an input, or a focusable view.
    pub(super) fn can_focus(&self, n: &Node) -> bool {
        n.input.is_some() || n.focusable.0 & focusable_flag::FOCUSABLE != 0
    }

    /// Whether Tab visits it.
    pub(super) fn tabbable(&self, n: &Node) -> bool {
        self.can_focus(n) && n.focusable.0 & focusable_flag::SKIP_TAB == 0
    }

    /// The innermost node at or above `id` that can take the focus.
    pub(super) fn focus_target(&self, mut id: u32) -> Option<u32> {
        loop {
            let n = self.nodes.get(&id)?;
            if self.can_focus(n) {
                return Some(id);
            }
            id = n.parent?;
        }
    }

    /// Whether the focus is showing a ring (it came from the keyboard).
    pub fn focus_visible(&self) -> bool {
        self.focus_visible && self.focus.is_some()
    }

    /// A key for the focused view (not an input). Returns whether it was used:
    /// Tab moves the focus, Enter and Space press it, and the scrolling keys
    /// scroll it, or the scroll view it's in.
    pub(super) fn view_key(&mut self, id: u32, key: u32, shift: bool) -> bool {
        if key == k::TAB {
            self.tab(shift);
            return true;
        }
        let node = &self.nodes[&id];
        if (key == k::ENTER || key == ' ' as u32) && node.listen & event_mask::PRESS != 0 {
            if let Some(b) = self.boxes.iter().find(|b| b.id == id) {
                let r = b.rect;
                self.events.push(TreeEvent::Press { id, x: (r[0] + r[2]) / 2.0, y: (r[1] + r[3]) / 2.0 });
            }
            return true;
        }
        self.scroll_key(id, key, shift)
    }

    /// The scrolling keys: a focused scroll view takes them all (arrows, Page
    /// Up and Down, Space, Home and End); a view inside one only those that
    /// don't move between items (pages, Home and End), so an app's arrow keys
    /// still reach it. Returns whether something scrolled.
    fn scroll_key(&mut self, id: u32, key: u32, shift: bool) -> bool {
        let own = self.nodes[&id].scroll.is_some();
        let view = if own {
            id
        } else {
            let mut a = self.nodes[&id].parent;
            loop {
                match a {
                    Some(p) if self.nodes[&p].scroll.is_some() => break p,
                    Some(p) => a = self.nodes[&p].parent,
                    None => return false,
                }
            }
        };
        let Some(st) = self.nodes[&view].scroll else { return false };
        let Some(b) = self.boxes.iter().find(|b| b.id == view) else { return false };
        let page = ((b.layout[3] - b.layout[1]) * PAGE).max(LINE);
        let [x, y] = st.offset;
        let to = match key {
            k::PAGE_DOWN => [x, y + page],
            k::PAGE_UP => [x, y - page],
            k::HOME => [x, 0.0],
            k::END => [x, st.max[1]],
            c if c == ' ' as u32 && own => [x, if shift { y - page } else { y + page }],
            k::ARROW_DOWN if own => [x, y + LINE],
            k::ARROW_UP if own => [x, y - LINE],
            k::ARROW_RIGHT if own => [x + LINE, y],
            k::ARROW_LEFT if own => [x - LINE, y],
            _ => return false,
        };
        self.set_offset(view, to[0], to[1])
    }
}
