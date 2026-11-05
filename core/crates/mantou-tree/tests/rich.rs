//! Rich text (dunkbing/mantou#15): spans inside a Text, set with TEXT_RUNS.
use mantou_tree::protocol::{Prop, cursor, event_mask};
use mantou_tree::{Ops, Tree, Value};

const RED: u32 = 0xff0000ff;
const YELLOW: u32 = 0xff00ffff;

/// Text 2, "Hello world", in a root (1); span 10 ("world", bytes 6..11) is
/// bold, red, highlighted yellow, presses and shows the pointer.
fn rich() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .style(1, Prop::AlignItems, Value::Enum(mantou_tree::protocol::align_items::START))
        .create_text(2)
        .style(2, Prop::FontSize, Value::F32(20.0))
        .text(2, "Hello world")
        .insert(1, 2, 0)
        .set_root(1)
        .create_text(10)
        .style(10, Prop::FontWeight, Value::F32(800.0))
        .style(10, Prop::Color, Value::Color(RED))
        .style(10, Prop::BackgroundColor, Value::Color(YELLOW))
        .style(10, Prop::Cursor, Value::Enum(cursor::POINTER))
        .listen(10, event_mask::PRESS)
        .text_runs(2, &[(6, &[]), (5, &[10])]);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t.scene();
    t
}

fn apply(t: &mut Tree, f: impl FnOnce(&mut Ops)) -> Vec<String> {
    let mut o = Ops::new();
    f(&mut o);
    let r = t.apply(&o.bytes()).unwrap();
    t.layout();
    r.errors
}

fn red_glyphs(t: &mut Tree) -> usize {
    t.scene().quads.iter().filter(|q| q.is_glyph() && q.color == [1.0, 0.0, 0.0, 1.0]).count()
}

#[test]
fn a_span_sets_its_runs_in_its_style() {
    let mut t = rich();
    assert_eq!(red_glyphs(&mut t), 5, "\"world\" is red");
    let scene = t.scene();
    let highlight = scene.quads.iter().find(|q| !q.is_glyph() && q.color == [1.0, 1.0, 0.0, 1.0]).expect("a yellow highlight");
    let world = t.rect(2).unwrap();
    assert!(highlight.rect[0] > world[0] + 30.0 && highlight.rect[2] <= world[2] + 1.0, "under \"world\" only: {:?} in {world:?}", highlight.rect);
    // Bold is wider than the same text without the span.
    let bold_width = world[2] - world[0];
    apply(&mut t, |o| {
        o.text_runs(2, &[]);
    });
    let plain = t.rect(2).unwrap();
    assert!(bold_width > plain[2] - plain[0], "{bold_width} vs {}", plain[2] - plain[0]);
    assert_eq!(red_glyphs(&mut t), 0, "no runs: all in the Text's style");
}

#[test]
fn presses_and_the_cursor_over_a_span_go_to_it() {
    let mut t = rich();
    let r = t.rect(2).unwrap();
    let (y, near_end, near_start) = ((r[1] + r[3]) / 2.0, r[2] - 5.0, r[0] + 5.0);
    assert_eq!(t.press_target(near_end, y), Some(10), "over \"world\"");
    assert_eq!(t.press_target(near_start, y), None, "over \"Hello\": nothing listens");
    t.pointer_at(Some((near_end, y)));
    assert_eq!(t.cursor(), cursor::POINTER);
    t.pointer_at(Some((near_start, y)));
    assert_eq!(t.cursor(), cursor::DEFAULT);
    // A listener on the Text: presses on plain runs go to it, on the span still to the span (it bubbles in JS).
    apply(&mut t, |o| {
        o.listen(2, event_mask::PRESS);
    });
    assert_eq!(t.press_target(near_start, y), Some(2));
    assert_eq!(t.press_target(near_end, y), Some(10));
}

#[test]
fn restyling_a_span_redraws_its_text_and_a_colour_lays_nothing_out() {
    let mut t = rich();
    let layouts = t.stats().text_layouts;
    apply(&mut t, |o| {
        o.style(10, Prop::Color, Value::Color(0xff00ff00));
    });
    assert_eq!(red_glyphs(&mut t), 0);
    assert_eq!(t.scene().quads.iter().filter(|q| q.is_glyph() && q.color == [0.0, 1.0, 0.0, 1.0]).count(), 5, "now green");
    assert_eq!(t.stats().text_layouts, layouts, "a colour isn't part of the layout");
    let before = t.rect(2).unwrap();
    apply(&mut t, |o| {
        o.style(10, Prop::FontSize, Value::F32(40.0));
    });
    let after = t.rect(2).unwrap();
    assert!(after[3] - after[1] > before[3] - before[1], "a bigger span makes the line taller");
}

#[test]
fn nested_spans_apply_outermost_first() {
    let mut t = rich();
    // Span 11 inside span 10 over "wor": it keeps 10's red and bold, and adds italic and its own colour.
    let errors = apply(&mut t, |o| {
        o.create_text(11).style(11, Prop::Color, Value::Color(0xffff0000)).text_runs(2, &[(6, &[]), (3, &[10, 11]), (2, &[10])]);
    });
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(red_glyphs(&mut t), 2, "\"ld\" is still 10's red");
    assert_eq!(t.scene().quads.iter().filter(|q| q.is_glyph() && q.color == [0.0, 0.0, 1.0, 1.0]).count(), 3, "\"wor\" is 11's blue");
    let r = t.rect(2).unwrap();
    // The innermost span is the press target, even though only the outer one listens.
    let y = (r[1] + r[3]) / 2.0;
    let wor = (r[0]..r[2]).step_by_f32(1.0).find(|&x| t.press_target(x, y) == Some(11));
    assert!(wor.is_some(), "\"wor\" goes to span 11");
}

#[test]
fn bad_runs_are_refused_and_released_spans_are_dropped() {
    let mut t = rich();
    let e = apply(&mut t, |o| {
        o.text_runs(2, &[(6, &[]), (9, &[10])]);
    });
    assert_eq!(e.len(), 1, "15 bytes for an 11-byte text: {e:?}");
    let e = apply(&mut t, |o| {
        o.text_runs(2, &[(11, &[1])]);
    });
    assert_eq!(e.len(), 1, "a view can't be a span: {e:?}");
    let e = apply(&mut t, |o| {
        o.text_runs(1, &[(11, &[10])]);
    });
    assert_eq!(e.len(), 1, "only a Text has runs");
    // The span is released: its run falls back to the Text's style.
    apply(&mut t, |o| {
        o.text_runs(2, &[(6, &[]), (5, &[10])]).release(10);
    });
    assert_eq!(red_glyphs(&mut t), 0);
    t.check().unwrap();
}

trait StepF32 {
    fn step_by_f32(self, step: f32) -> Box<dyn Iterator<Item = f32>>;
}

impl StepF32 for std::ops::Range<f32> {
    fn step_by_f32(self, step: f32) -> Box<dyn Iterator<Item = f32>> {
        let (start, end) = (self.start, self.end);
        Box::new((0..).map(move |i| start + i as f32 * step).take_while(move |&x| x < end))
    }
}
