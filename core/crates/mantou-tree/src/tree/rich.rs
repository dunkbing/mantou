//! Rich text (dunkbing/mantou#15): spans inside a Text. A span is a Text node
//! that is never inserted; TEXT_RUNS splits the Text's text into runs, each
//! naming the spans it's in (outermost first). A run's style is the Text's,
//! with its spans' text properties over it; a span's background colour
//! highlights its runs. Presses and the cursor over a run go to its innermost
//! span. Colours aren't part of the layout: recolouring a span lays nothing out.

use mantou_text::Span;

use super::{Node, Tree, Visual, set_prop};
use crate::protocol::node_kind;

/// A Text's runs, as sent, and their resolved styles.
#[derive(Default)]
pub(super) struct Rich {
    /// (UTF-8 byte length, span ids outermost first).
    pub(super) runs: Vec<(u32, Vec<u32>)>,
    /// The runs that are in spans, in order: their layout styles, for `layout_rich`.
    pub(super) spans: Vec<Span>,
    /// For each of `spans`: its colour, background (0 = none) and spans (outermost first).
    pub(super) looks: Vec<Look>,
}

pub(super) struct Look {
    pub(super) color: u32,
    pub(super) background: u32,
    pub(super) chain: Vec<u32>,
}

impl Tree {
    /// TEXT_RUNS: sets a Text's runs (none: plain text).
    pub(super) fn set_runs(&mut self, id: u32, runs: Vec<(u32, Vec<u32>)>) -> Result<(), String> {
        let node = self.nodes.get(&id).ok_or_else(|| format!("no node {id}"))?;
        if node.kind != node_kind::TEXT {
            return Err(format!("TEXT_RUNS: {id} is not a text node"));
        }
        let total: u64 = runs.iter().map(|r| r.0 as u64).sum();
        if !runs.is_empty() && total != node.text.len() as u64 {
            return Err(format!("TEXT_RUNS: the runs cover {total} bytes, the text has {}", node.text.len()));
        }
        for (_, chain) in &runs {
            for &s in chain {
                match self.nodes.get(&s) {
                    Some(n) if n.kind == node_kind::TEXT && s != id && n.parent.is_none() => {}
                    _ => return Err(format!("TEXT_RUNS: span {s} is not a free text node")),
                }
            }
        }
        // The spans it used no longer belong to it; the new ones do.
        let old = self.nodes.get_mut(&id).expect("checked").rich.take();
        for s in old.iter().flat_map(|r| r.runs.iter().flat_map(|(_, c)| c.iter())) {
            if let Some(n) = self.nodes.get_mut(s)
                && n.span_of == Some(id)
            {
                n.span_of = None;
            }
        }
        if !runs.is_empty() {
            for s in runs.iter().flat_map(|(_, c)| c.iter()) {
                self.nodes.get_mut(s).expect("checked").span_of = Some(id);
            }
            self.nodes.get_mut(&id).expect("checked").rich = Some(Box::new(Rich { runs, ..Rich::default() }));
        }
        self.resolve_rich(id);
        Ok(())
    }

    /// Works a Text's span styles out again (after its runs, its style or a span's style changed).
    pub(super) fn resolve_rich(&mut self, id: u32) {
        let Some(node) = self.nodes.get(&id) else { return };
        let base = node.v;
        let mut spans = Vec::new();
        let mut looks = Vec::new();
        if let Some(rich) = &node.rich {
            let mut at = 0u32;
            for (len, chain) in &rich.runs {
                let (start, end) = (at, at.saturating_add(*len));
                at = end;
                if chain.is_empty() {
                    continue;
                }
                let v = self.span_visual(base, chain);
                // Only the font, spacing and decoration come from spans; the rest is the Text's.
                let style = mantou_text::TextStyle { size: v.text.size, weight: v.text.weight, italic: v.text.italic, family: v.text.family, letter_spacing: v.text.letter_spacing, decoration: v.text.decoration, ..base.text };
                spans.push(Span { start, end, style });
                looks.push(Look { color: v.color, background: v.background, chain: chain.clone() });
            }
        }
        let node = self.nodes.get_mut(&id).expect("exists");
        if let Some(rich) = node.rich.as_mut() {
            rich.spans = spans;
            rich.looks = looks;
        }
        *node.drawn.get_mut() = None;
        let t = node.taffy;
        let _ = self.taffy.mark_dirty(t);
        self.layout_dirty = true;
        self.scene_dirty = true;
    }

    /// A run's look: the Text's, with each span's own text properties over it, outermost first.
    fn span_visual(&self, base: Visual, chain: &[u32]) -> Visual {
        let mut v = Visual { background: 0, ..base };
        let mut scratch = taffy::style::Style::default();
        for s in chain {
            let Some(n) = self.nodes.get(s) else { continue };
            let shared = self.styles.get(&n.shared).map(|v| v.as_slice()).unwrap_or(&[]);
            for (prop, value) in shared.iter().copied().chain(n.own.iter().map(|(k, v)| (*k, *v))) {
                set_prop(&mut scratch, &mut v, prop, value);
            }
        }
        v
    }

    /// The spans (outermost first) of the run under a point on a Text, if it's in any.
    pub(super) fn spans_at(&self, id: u32, x: f32, y: f32) -> Option<&[u32]> {
        let node = self.nodes.get(&id)?;
        let rich = node.rich.as_ref()?;
        let b = self.boxes.iter().find(|b| b.id == id)?;
        let drawn = node.drawn.borrow();
        let (_, layout) = drawn.as_ref()?;
        let span = layout.span_at((x - b.content[0]) / b.k, (y - b.content[1]) / b.k)?;
        rich.looks.get((span as usize).checked_sub(1)?).map(|l| l.chain.as_slice())
    }
}

impl Node {
    /// A Text's spans' layout styles (none for plain text).
    pub(super) fn spans(&self) -> &[Span] {
        self.rich.as_ref().map_or(&[], |r| &r.spans)
    }
}
