//! Hover and cursors (dunkbing/mantou#18): the core knows which nodes are
//! under the pointer, tells Hover listeners when the pointer comes over and
//! leaves them, and picks the cursor the window shows, with no JS round trip.
//! The hovered path is worked out again whenever the pointer moves or the
//! boxes are placed again (a layout, a scroll, an animation), so a node that
//! moves away from a still pointer is left too.

use super::{Tree, TreeEvent};
use crate::protocol::{cursor, event_mask};

impl Tree {
    /// The pointer is at (x, y) logical px, or left the window (`None`). Returns whether boxes must be
    /// placed again: a FOLLOW_POINTER node moves with it.
    pub fn pointer_at(&mut self, at: Option<(f32, f32)>) -> bool {
        let moved = self.pointer != at;
        self.pointer = at;
        if moved && self.follow.is_some() && at.is_some() {
            self.boxes_dirty = true;
            return true;
        }
        self.update_hover();
        false
    }

    /// Works out the hovered path again; queues POINTER_LEAVE for listening
    /// nodes it left (innermost first), then POINTER_ENTER for those it came
    /// over (outermost first).
    pub(super) fn update_hover(&mut self) {
        let mut path = Vec::new();
        let mut at = self.pointer.and_then(|(x, y)| self.hit(x, y));
        while let Some(id) = at {
            path.push(id);
            at = self.nodes[&id].parent;
        }
        path.reverse();
        if path == self.hovered {
            return;
        }
        let listens = |t: &Tree, id: u32| t.nodes.get(&id).is_some_and(|n| n.listen & event_mask::HOVER != 0);
        for &id in self.hovered.iter().rev() {
            if !path.contains(&id) && listens(self, id) {
                self.events.push(TreeEvent::PointerLeave(id));
            }
        }
        for &id in &path {
            if !self.hovered.contains(&id) && listens(self, id) {
                self.events.push(TreeEvent::PointerEnter(id));
            }
        }
        self.hovered = path;
    }

    /// A node started listening for hover: if the pointer is already over it, it hears so.
    pub(super) fn hover_listener_added(&mut self, id: u32) {
        if self.hovered.contains(&id) {
            self.events.push(TreeEvent::PointerEnter(id));
        }
    }

    /// The nodes under the pointer, outermost first.
    pub fn hovered(&self) -> &[u32] {
        &self.hovered
    }

    /// The cursor to show (a `protocol::cursor` value, never AUTO): over a
    /// span, the innermost span's that sets one; then the innermost hovered
    /// node's that sets one, else the text cursor over an
    /// input, else the arrow. Over a scrollbar thumb, the arrow.
    pub fn cursor(&self) -> u32 {
        if self.pointer.is_some_and(|(x, y)| self.on_thumb(x, y)) {
            return cursor::DEFAULT;
        }
        // Over a run in spans, the innermost span that sets a cursor (a link's pointer).
        if let (Some(&last), Some((x, y))) = (self.hovered.last(), self.pointer)
            && let Some(spans) = self.spans_at(last, x, y)
            && let Some(c) = spans.iter().rev().filter_map(|s| self.nodes.get(s)).map(|n| n.v.cursor).find(|&c| c != cursor::AUTO)
        {
            return c;
        }
        for &id in self.hovered.iter().rev() {
            let n = &self.nodes[&id];
            if n.v.cursor != cursor::AUTO {
                return n.v.cursor;
            }
            if n.input.is_some() {
                return cursor::TEXT;
            }
        }
        cursor::DEFAULT
    }
}
