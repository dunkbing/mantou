//! Focusable views (dunkbing/mantou#17): Tab order, presses, the focus ring,
//! Enter and Space, and keyboard scrolling.
use mantou_tree::protocol::{Prop, event_mask, focus_scope_flag, focusable_flag as ff, key_modifier as m, named_key as k, overflow};
use mantou_tree::{Length, MemoryClipboard, Ops, Tree, TreeEvent, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

/// A column (1) of: a button (2, focusable, presses), an input (3), a skipped
/// view (4, focusable but not by Tab), and a scroll view (5, focusable) of 20
/// rows of 50 px, the first row (100) focusable too.
fn ui() -> Tree {
    let mut o = Ops::new();
    o.create(1).style(1, Prop::PaddingLeft, px(10.0)).style(1, Prop::PaddingTop, px(10.0)).style(1, Prop::RowGap, px(10.0)).set_root(1);
    for (id, h) in [(2, 30.0), (4, 30.0)] {
        o.create(id).style(id, Prop::Width, px(100.0)).style(id, Prop::Height, px(h)).style(id, Prop::FlexShrink, Value::F32(0.0)).insert(1, id, 0);
    }
    o.create_input(3).style(3, Prop::Width, px(100.0)).style(3, Prop::Height, px(30.0)).insert(1, 3, 4);
    o.focusable(2, ff::FOCUSABLE, 0).listen(2, event_mask::PRESS).focusable(4, ff::FOCUSABLE | ff::SKIP_TAB, 0);
    o.create(5).style(5, Prop::Overflow, Value::Enum(overflow::SCROLL)).style(5, Prop::Height, px(200.0)).style(5, Prop::FlexShrink, Value::F32(0.0)).focusable(5, ff::FOCUSABLE, 0).insert(1, 5, 0);
    for i in 0..20 {
        let id = 100 + i;
        o.create(id).style(id, Prop::Height, px(50.0)).style(id, Prop::FlexShrink, Value::F32(0.0)).insert(5, id, 0);
    }
    o.focusable(100, ff::FOCUSABLE, 0);
    let mut t = Tree::new();
    t.set_viewport(400, 600, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn key(t: &mut Tree, key: u32, mods: u32) -> bool {
    let used = t.key(key, None, mods, &mut MemoryClipboard::default());
    t.layout();
    used
}

fn apply(t: &mut Tree, f: impl FnOnce(&mut Ops)) -> Vec<String> {
    let mut o = Ops::new();
    f(&mut o);
    let r = t.apply(&o.bytes()).unwrap();
    t.layout();
    r.errors
}

/// The focus ring's quad, if one is drawn: a border with no fill.
fn ring(t: &mut Tree) -> Option<[f32; 4]> {
    t.scene().quads.iter().find(|q| !q.is_glyph() && q.color[3] == 0.0 && q.border > 0.0).map(|q| q.rect)
}

#[test]
fn tab_goes_through_inputs_and_focusable_views_in_tree_order() {
    let mut t = ui();
    let mut seen = Vec::new();
    for _ in 0..5 {
        assert!(key(&mut t, k::TAB, 0));
        seen.push(t.focused().unwrap());
    }
    assert_eq!(seen, [2, 3, 5, 100, 2], "the skipped view isn't visited; it wraps around");
    key(&mut t, k::TAB, m::SHIFT);
    assert_eq!(t.focused(), Some(100), "Shift+Tab goes back");
    // An order goes first.
    apply(&mut t, |o| {
        o.focusable(5, ff::FOCUSABLE, 1);
    });
    key(&mut t, k::TAB, 0);
    assert_eq!(t.focused(), Some(5), "after 100 comes the first of the order");
    key(&mut t, k::TAB, 0);
    assert_eq!(t.focused(), Some(2));
    // Inside a trapping scope, Tab stays there.
    apply(&mut t, |o| {
        o.focus_scope(5, focus_scope_flag::TRAP);
    });
    key(&mut t, k::TAB, 0);
    key(&mut t, k::TAB, 0);
    key(&mut t, k::TAB, 0);
    assert!(matches!(t.focused(), Some(5) | Some(100)), "{:?}", t.focused());
}

#[test]
fn nothing_to_reach_leaves_tab_to_the_app() {
    let mut o = Ops::new();
    o.create(1).set_root(1);
    let mut t = Tree::new();
    t.apply(&o.bytes()).unwrap();
    t.layout();
    assert!(!key(&mut t, k::TAB, 0));
}

#[test]
fn a_press_focuses_without_a_ring_and_tab_shows_one() {
    let mut t = ui();
    let r = t.rect(2).unwrap();
    t.pointer_down(r[0] + 5.0, r[1] + 5.0, 1, false);
    t.pointer_up();
    assert_eq!(t.focused(), Some(2));
    assert_eq!(t.take_events(), vec![TreeEvent::Focus(2)]);
    assert!(!t.focus_visible());
    assert_eq!(ring(&mut t), None, "the pointer gave the focus: no ring");
    key(&mut t, k::TAB, 0);
    key(&mut t, k::TAB, m::SHIFT);
    assert_eq!(t.focused(), Some(2));
    assert_eq!(ring(&mut t), Some([r[0] - 4.0, r[1] - 4.0, r[2] + 4.0, r[3] + 4.0]), "2 px out, 2 px wide");
    // Styled: another offset, and transparent for none.
    apply(&mut t, |o| {
        o.style(2, Prop::FocusRingOffset, Value::F32(0.0));
    });
    assert_eq!(ring(&mut t), Some([r[0] - 2.0, r[1] - 2.0, r[2] + 2.0, r[3] + 2.0]));
    apply(&mut t, |o| {
        o.style(2, Prop::FocusRingColor, Value::Color(0));
    });
    assert_eq!(ring(&mut t), None);
    // A press elsewhere blurs.
    t.pointer_down(300.0, 590.0, 1, false);
    assert_eq!(t.focused(), None);
}

#[test]
fn enter_and_space_press_the_focused_view() {
    let mut t = ui();
    key(&mut t, k::TAB, 0);
    t.take_events();
    let r = t.rect(2).unwrap();
    assert!(key(&mut t, k::ENTER, 0));
    assert!(key(&mut t, ' ' as u32, 0));
    let centre = ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0);
    assert_eq!(t.take_events(), vec![TreeEvent::Press { id: 2, x: centre.0, y: centre.1 }; 2]);
    // A view without a press listener leaves them to the app.
    apply(&mut t, |o| {
        o.listen(2, 0);
    });
    assert!(!key(&mut t, k::ENTER, 0));
    assert!(!key(&mut t, 'j' as u32, 0), "other keys are the app's");
}

#[test]
fn a_focused_scroll_view_scrolls_with_the_keys() {
    let mut t = ui();
    apply(&mut t, |o| {
        o.focus(5);
    });
    let max = t.scroll_max(5).unwrap()[1];
    assert_eq!(max, 20.0 * 50.0 - 200.0);
    let y = |t: &Tree| t.scroll_offset(5).unwrap()[1];
    assert!(key(&mut t, k::ARROW_DOWN, 0));
    assert_eq!(y(&t), 40.0);
    assert!(key(&mut t, k::PAGE_DOWN, 0));
    assert_eq!(y(&t), 40.0 + 180.0, "a page is 90% of the view");
    assert!(key(&mut t, ' ' as u32, m::SHIFT));
    assert_eq!(y(&t), 40.0);
    assert!(key(&mut t, k::END, 0));
    assert_eq!(y(&t), max);
    assert!(!key(&mut t, k::PAGE_DOWN, 0), "at the end: not used, so it reaches the app");
    assert!(key(&mut t, k::HOME, 0));
    assert_eq!(y(&t), 0.0);
    assert!(!key(&mut t, k::ARROW_UP, 0));
}

#[test]
fn a_view_in_a_scroll_view_pages_it_but_leaves_the_arrows_to_the_app() {
    let mut t = ui();
    apply(&mut t, |o| {
        o.focus(100);
    });
    assert!(key(&mut t, k::PAGE_DOWN, 0));
    assert_eq!(t.scroll_offset(5).unwrap()[1], 180.0);
    assert!(!key(&mut t, k::ARROW_DOWN, 0), "arrows move between the app's items");
    assert_eq!(t.scroll_offset(5).unwrap()[1], 180.0);
}

#[test]
fn focus_from_the_app_works_on_views_and_only_focusable_ones() {
    let mut t = ui();
    assert!(apply(&mut t, |o| {
        o.focus(2);
    })
    .is_empty());
    assert_eq!(t.focused(), Some(2));
    assert!(!t.focus_visible(), "no key pressed yet: no ring");
    assert_eq!(apply(&mut t, |o| {
        o.focus(1);
    })
    .len(), 1, "a plain view can't take the focus");
    // No longer focusable: it loses the focus.
    apply(&mut t, |o| {
        o.focusable(2, 0, 0);
    });
    assert_eq!(t.focused(), None);
}
