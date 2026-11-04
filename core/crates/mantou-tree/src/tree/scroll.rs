//! Scroll views (design §9.4): nodes with `overflow: "scroll"`. The core
//! keeps each one's offset and applies it when it places boxes, so scrolling
//! needs no relayout and no JS: the wheel and trackpad (momentum comes from
//! the OS) and dragging the thumb are handled here, on whichever thread
//! delivers the input. The app scrolls with SCROLL_TO and SCROLL_INTO_VIEW,
//! which wait for the batch's layout, and hears SCROLL events if it listens.

use super::{LaidOut, Tree, TreeEvent};
use crate::protocol::{event_mask, scroll_block, scroll_flag};

/// The thumb's thickness, its inset from the scroll view's edge, and its shortest length (logical px).
const THUMB: f32 = 6.0;
const INSET: f32 = 2.0;
const MIN_THUMB: f32 = 24.0;

/// A scroll view's scrolling state, kept on its node.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct ScrollState {
    pub(super) offset: [f32; 2],
    /// How far it can scroll (content minus viewport), from the last placement.
    pub(super) max: [f32; 2],
    /// The offset last sent in a SCROLL event.
    pub(super) reported: Option<[f32; 2]>,
}

/// A request from the app, applied after the batch's layout.
#[derive(Clone, Copy, Debug)]
pub(super) enum Request {
    To { id: u32, x: f32, y: f32, by: bool },
    IntoView { id: u32, block: u32 },
}

/// A scrollbar thumb to draw (over its view's content) and to drag.
#[derive(Clone, Copy, Debug)]
pub(super) struct Thumb {
    pub(super) view: u32,
    /// 0 = vertical, 1 = horizontal.
    pub(super) axis: usize,
    /// The box index it's drawn before: right after its view's last descendant.
    pub(super) at: usize,
    pub(super) rect: [f32; 4],
    pub(super) clip: [f32; 4],
    /// Offset per logical px of thumb movement.
    pub(super) ratio: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Drag {
    view: u32,
    axis: usize,
    from: f32,
    offset: f32,
    ratio: f32,
}

/// Where a scroll view's content can go: its padding box (inside the border), in window px.
pub(super) fn viewport(b: &LaidOut, border: [f32; 4]) -> [f32; 4] {
    [b.rect[0] + border[0], b.rect[1] + border[1], b.rect[2] - border[2], b.rect[3] - border[3]]
}

impl Tree {
    /// Sets a scroll view's offset, clamped; returns whether it moved.
    pub(super) fn set_offset(&mut self, id: u32, x: f32, y: f32) -> bool {
        let Some(st) = self.nodes.get_mut(&id).and_then(|n| n.scroll.as_mut()) else { return false };
        let clamp = |v: f32, max: f32| if v.is_finite() { v.clamp(0.0, max) } else { 0.0 };
        let next = [clamp(x, st.max[0]), clamp(y, st.max[1])];
        if next == st.offset {
            return false;
        }
        st.offset = next;
        self.boxes_dirty = true;
        true
    }

    /// A scroll view's offset (for tests and debugging).
    pub fn scroll_offset(&self, id: u32) -> Option<[f32; 2]> {
        self.nodes.get(&id)?.scroll.map(|s| s.offset)
    }

    /// How far a scroll view can scroll, from the last layout.
    pub fn scroll_max(&self, id: u32) -> Option<[f32; 2]> {
        self.nodes.get(&id)?.scroll.map(|s| s.max)
    }

    /// The wheel or trackpad at (x, y) logical px, by (dx, dy) (positive dy
    /// moves the content up): scrolls the innermost scroll view under the
    /// point that can move that way. Returns whether one did.
    pub fn wheel(&mut self, x: f32, y: f32, dx: f32, dy: f32) -> bool {
        let mut at = self.hit(x, y);
        while let Some(id) = at {
            let node = &self.nodes[&id];
            if let Some(st) = node.scroll {
                let can = |d: f32, axis: usize| (d > 0.0 && st.offset[axis] < st.max[axis]) || (d < 0.0 && st.offset[axis] > 0.0);
                if can(dx, 0) || can(dy, 1) {
                    return self.set_offset(id, st.offset[0] + dx, st.offset[1] + dy);
                }
            }
            at = node.parent;
        }
        false
    }

    /// The topmost scrollbar thumb at (x, y), if any (a little wider than drawn, to be easy to grab).
    fn thumb_at(&self, x: f32, y: f32) -> Option<Thumb> {
        let grab = 2.0;
        self.thumbs.iter().rev().copied().find(|t| {
            let r = t.rect;
            x >= r[0] - grab && x < r[2] + grab && y >= r[1] - grab && y < r[3] + grab && x >= t.clip[0] && x < t.clip[2] && y >= t.clip[1] && y < t.clip[3]
        })
    }

    /// Whether (x, y) is on a scrollbar thumb: presses there don't reach the content.
    pub fn on_thumb(&self, x: f32, y: f32) -> bool {
        self.thumb_at(x, y).is_some()
    }

    /// The primary button went down at (x, y): on a thumb, starts dragging it.
    pub(super) fn thumb_down(&mut self, x: f32, y: f32) -> bool {
        let Some(t) = self.thumb_at(x, y) else { return false };
        let offset = self.nodes[&t.view].scroll.map_or(0.0, |s| s.offset[t.axis]);
        self.thumb_drag = Some(Drag { view: t.view, axis: t.axis, from: if t.axis == 1 { y } else { x }, offset, ratio: t.ratio });
        true
    }

    /// The pointer moved with a thumb held: scrolls its view.
    pub(super) fn thumb_move(&mut self, x: f32, y: f32) -> bool {
        let Some(d) = self.thumb_drag else { return false };
        let to = d.offset + ((if d.axis == 1 { y } else { x }) - d.from) * d.ratio;
        let Some(st) = self.nodes.get(&d.view).and_then(|n| n.scroll) else { return false };
        let mut next = st.offset;
        next[d.axis] = to;
        self.set_offset(d.view, next[0], next[1])
    }

    pub(super) fn thumb_up(&mut self) -> bool {
        self.thumb_drag.take().is_some()
    }

    /// Applies the app's scroll requests, against the boxes just placed.
    /// Returns whether any offset moved.
    pub(super) fn apply_requests(&mut self) -> bool {
        let mut moved = false;
        for r in std::mem::take(&mut self.requests) {
            match r {
                Request::To { id, x, y, by } => {
                    let Some(st) = self.nodes.get(&id).and_then(|n| n.scroll) else { continue };
                    let pick = |v: f32, axis: usize| if v.is_nan() { st.offset[axis] } else if by { st.offset[axis] + v } else { v };
                    moved |= self.set_offset(id, pick(x, 0), pick(y, 1));
                }
                Request::IntoView { id, block } => moved |= self.into_view(id, block),
            }
            if moved {
                self.place_boxes(); // the next request sees where this one left things
            }
        }
        moved
    }

    /// Scrolls each scroll-view ancestor of `id`, innermost first, so it shows.
    fn into_view(&mut self, id: u32, block: u32) -> bool {
        let mut moved = false;
        let mut at = self.nodes.get(&id).and_then(|n| n.parent);
        while let Some(view) = at {
            at = self.nodes[&view].parent;
            let Some(st) = self.nodes[&view].scroll else { continue };
            let (Some(r), Some(vb)) = (self.rect(id), self.boxes.iter().find(|b| b.id == view).copied()) else { continue };
            let v = viewport(&vb, self.borders(view).map(|b| b * vb.k));
            let mut next = st.offset;
            for axis in 0..2 {
                let (lo, hi, vlo, vhi) = (r[axis], r[axis + 2], v[axis], v[axis + 2]);
                // The block position is for the vertical axis; sideways, always nearest.
                let mode = if axis == 1 { block } else { scroll_block::NEAREST };
                next[axis] += match mode {
                    scroll_block::START => lo - vlo,
                    scroll_block::END => hi - vhi,
                    scroll_block::CENTER => (lo + hi) / 2.0 - (vlo + vhi) / 2.0,
                    // As little as it takes; a node bigger than the view lines up with its start.
                    _ if lo < vlo || hi - lo > vhi - vlo => lo - vlo,
                    _ if hi > vhi => hi - vhi,
                    _ => 0.0,
                };
            }
            // Window px to the view's own (a transform may scale it).
            let next = [st.offset[0] + (next[0] - st.offset[0]) / vb.k, st.offset[1] + (next[1] - st.offset[1]) / vb.k];
            if self.set_offset(view, next[0], next[1]) {
                moved = true;
                self.place_boxes();
            }
        }
        moved
    }

    /// The border widths (left, top, right, bottom) of a node, from the last layout.
    pub(super) fn borders(&self, id: u32) -> [f32; 4] {
        let Ok(l) = self.taffy.layout(self.nodes[&id].taffy) else { return [0.0; 4] };
        [l.border.left, l.border.top, l.border.right, l.border.bottom]
    }

    /// Queues a SCROLL event for each listening scroll view whose offset changed since it was last reported.
    pub(super) fn report_scrolls(&mut self) {
        for b in &self.boxes {
            let node = self.nodes.get_mut(&b.id).expect("laid-out nodes exist");
            if node.listen & event_mask::SCROLL == 0 {
                continue;
            }
            let Some(st) = node.scroll.as_mut() else { continue };
            if st.reported != Some(st.offset) {
                st.reported = Some(st.offset);
                self.events.push(TreeEvent::Scroll { id: b.id, offset: st.offset });
            }
        }
    }

    /// Queues a request from a SCROLL_TO op.
    pub(super) fn request_scroll_to(&mut self, id: u32, x: f32, y: f32, flags: u32) {
        self.requests.push(Request::To { id, x, y, by: flags & scroll_flag::BY != 0 });
    }

    pub(super) fn request_into_view(&mut self, id: u32, block: u32) {
        self.requests.push(Request::IntoView { id, block });
    }
}

/// The thumbs of a scroll view placed at `b`, if its content overflows.
pub(super) fn thumbs(view: u32, b: &LaidOut, border: [f32; 4], st: &ScrollState, content: [f32; 2], at: usize) -> Vec<Thumb> {
    let v = viewport(b, border);
    let mut out = Vec::new();
    for axis in 0..2 {
        if st.max[axis] <= 0.0 {
            continue;
        }
        let other = 1 - axis;
        // The track runs along the view's far edge, short of the other thumb's corner.
        let track = (v[axis + 2] - v[axis]) - 2.0 * INSET - if st.max[other] > 0.0 { THUMB + INSET } else { 0.0 };
        if track <= 0.0 {
            continue;
        }
        let len = (track * (v[axis + 2] - v[axis]) / content[axis]).clamp(MIN_THUMB.min(track), track);
        let pos = v[axis] + INSET + (track - len) * (st.offset[axis] / st.max[axis]);
        let across = v[other + 2] - INSET - THUMB;
        let rect = if axis == 1 { [across, pos, across + THUMB, pos + len] } else { [pos, across, pos + len, across + THUMB] };
        out.push(Thumb { view, axis, at, rect, clip: b.clip, ratio: if track > len { st.max[axis] / (track - len) } else { 0.0 } });
    }
    out
}

pub(super) const THUMB_RADIUS: f32 = THUMB / 2.0;
