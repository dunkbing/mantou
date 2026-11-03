//! Scroll views (overflow: "scroll"): wheel scrolling without relayout,
//! limits, nesting, the thumb, SCROLL_TO, SCROLL_INTO_VIEW and SCROLL events.
use mantou_tree::protocol::{Prop, event_mask, overflow, scroll_block as block, scroll_flag};
use mantou_tree::{Length, Ops, Tree, TreeEvent, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

const ROWS: u32 = 20;
const ROW: f32 = 30.0;

/// A 200 × 100 scroll view (2) at (0, 50) holding rows 100.. of 30 px, under a 50 px header (3).
fn list() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create(3)
        .style(3, Prop::Height, px(50.0))
        .style(3, Prop::FlexShrink, Value::F32(0.0))
        .create(2)
        .style(2, Prop::Overflow, Value::Enum(overflow::SCROLL))
        .style(2, Prop::Width, px(200.0))
        .style(2, Prop::Height, px(100.0))
        .insert(1, 3, 0)
        .insert(1, 2, 0)
        .set_root(1);
    for i in 0..ROWS {
        let id = 100 + i;
        o.create(id).style(id, Prop::Height, px(ROW)).style(id, Prop::FlexShrink, Value::F32(0.0)).insert(2, id, 0);
    }
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn top(t: &Tree, id: u32) -> f32 {
    t.rect(id).unwrap()[1]
}

#[test]
fn the_wheel_scrolls_within_limits_without_a_relayout() {
    let mut t = list();
    assert_eq!(t.scroll_max(2), Some([0.0, ROWS as f32 * ROW - 100.0]));
    let layouts = t.stats().layouts;
    assert!(t.wheel(50.0, 80.0, 0.0, 40.0));
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 40.0]));
    assert_eq!(top(&t, 100), 50.0 - 40.0, "the rows moved up");
    assert_eq!(t.stats().layouts, layouts, "placed again, not laid out again");
    assert!(t.wheel(50.0, 80.0, 0.0, 10_000.0));
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 500.0]), "clamped at the end");
    assert!(!t.wheel(50.0, 80.0, 0.0, 10.0), "already at the end");
    assert!(!t.wheel(50.0, 20.0, 0.0, -10.0), "over the header: nothing to scroll");
    assert!(t.wheel(50.0, 80.0, 0.0, -10_000.0));
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 0.0]));
    // What's scrolled out of the view is clipped: hit-testing there finds the view, not row 100.
    t.wheel(50.0, 80.0, 0.0, 60.0);
    t.layout();
    assert_eq!(t.hit(50.0, 45.0), Some(3), "row 100 is now above the view, under the header");
    assert_eq!(t.hit(50.0, 55.0), Some(102));
}

#[test]
fn an_inner_scroll_view_at_its_end_lets_the_outer_one_scroll() {
    let mut o = Ops::new();
    o.create(1)
        .create(2)
        .style(2, Prop::Overflow, Value::Enum(overflow::SCROLL))
        .style(2, Prop::Height, px(100.0))
        .create(3)
        .style(3, Prop::Overflow, Value::Enum(overflow::SCROLL))
        .style(3, Prop::Height, px(50.0))
        .style(3, Prop::FlexShrink, Value::F32(0.0))
        .create(4)
        .style(4, Prop::Height, px(80.0))
        .style(4, Prop::FlexShrink, Value::F32(0.0))
        .create(5)
        .style(5, Prop::Height, px(200.0))
        .style(5, Prop::FlexShrink, Value::F32(0.0))
        .insert(3, 4, 0)
        .insert(2, 3, 0)
        .insert(2, 5, 0)
        .insert(1, 2, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.apply(&o.bytes()).unwrap();
    t.layout();
    t.wheel(10.0, 10.0, 0.0, 100.0);
    t.layout();
    assert_eq!(t.scroll_offset(3), Some([0.0, 30.0]), "the inner view first, to its end");
    assert_eq!(t.scroll_offset(2), Some([0.0, 0.0]));
    // The pointer is still over the inner view, which can't go further: the outer one scrolls.
    t.wheel(10.0, 10.0, 0.0, 40.0);
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 40.0]));
}

#[test]
fn the_thumb_is_drawn_over_the_content_and_dragging_it_scrolls() {
    let mut t = list();
    let thumbs = |t: &mut Tree| t.scene().quads.iter().filter(|q| q.radius == 3.0).count();
    assert_eq!(thumbs(&mut t), 1);
    // The track is the view's height less 2 px each end (96 px); the thumb is
    // 100/600 of it, so 16 px, raised to the 24 px minimum, at the top.
    let (x, y) = (200.0 - 2.0 - 3.0, 50.0 + 2.0 + 5.0);
    assert!(t.on_thumb(x, y));
    assert_eq!(t.press_target(x, y), None, "presses on the thumb don't reach the content");
    t.pointer_down(x, y, 1, false);
    t.pointer_drag(x, y + 16.0); // 16 px of the free track (96 - 24 = 72 px): 500 / 72 per px
    t.pointer_up();
    t.layout();
    let offset = t.scroll_offset(2).unwrap()[1];
    assert!((offset - 16.0 * 500.0 / 72.0).abs() < 0.5, "{offset}");
    // scrollbar: "none" draws no thumb, and there's nothing to grab.
    let mut o = Ops::new();
    o.style(2, Prop::Scrollbar, Value::Enum(1));
    t.apply(&o.bytes()).unwrap();
    t.layout();
    assert_eq!(thumbs(&mut t), 0);
    assert!(!t.on_thumb(x, y));
}

#[test]
fn scroll_to_and_scroll_into_view_apply_after_the_batch_s_layout() {
    let mut t = list();
    // A row added in the same batch as the request is scrolled to.
    let mut o = Ops::new();
    o.create(200).style(200, Prop::Height, px(ROW)).style(200, Prop::FlexShrink, Value::F32(0.0)).insert(2, 200, 0).scroll_into_view(200, block::NEAREST);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 21.0 * ROW - 100.0]), "nearest: its bottom at the view's bottom");
    o.scroll_into_view(105, block::NEAREST);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 5.0 * ROW]), "nearest from below: its top at the view's top");
    o.scroll_into_view(106, block::NEAREST);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 5.0 * ROW]), "already showing: nothing moves");
    o.scroll_into_view(110, block::CENTER);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 10.0 * ROW + ROW / 2.0 - 50.0]));
    o.scroll_into_view(110, block::END);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 11.0 * ROW - 100.0]));
    o.scroll_to(2, f32::NAN, 0.0, 0);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 0.0]));
    o.scroll_to(2, 0.0, 45.0, scroll_flag::BY).scroll_to(2, 0.0, 45.0, scroll_flag::BY);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 90.0]), "two scroll-bys add up");
}

#[test]
fn shrinking_content_clamps_the_offset() {
    let mut t = list();
    let mut o = Ops::new();
    o.scroll_to(2, 0.0, 500.0, 0);
    t.apply(&o.take()).unwrap();
    t.layout();
    for i in 5..ROWS {
        o.release(100 + i);
    }
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.scroll_offset(2), Some([0.0, 50.0]), "5 rows of 30 in a 100 px view");
}

#[test]
fn scroll_listeners_hear_each_new_offset_once() {
    let mut t = list();
    let mut o = Ops::new();
    o.listen(2, event_mask::SCROLL);
    t.apply(&o.take()).unwrap();
    t.layout();
    t.take_events();
    t.wheel(50.0, 80.0, 0.0, 30.0);
    t.wheel(50.0, 80.0, 0.0, 30.0);
    t.layout();
    assert_eq!(t.take_events(), vec![TreeEvent::Scroll { id: 2, offset: [0.0, 60.0] }], "two wheel turns, one placement: one event");
    t.layout();
    assert!(t.take_events().is_empty());
}
