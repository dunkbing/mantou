//! Hover and cursors (dunkbing/mantou#18), and SELECT (dunkbing/mantou#30).
use mantou_tree::protocol::{Prop, cursor, event_mask, overflow, position};
use mantou_tree::{Length, Ops, Tree, TreeEvent, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

/// A 400 × 300 root (1) holding a card (2) at (0, 0), 200 × 100, with a
/// button (3) at its top left, 50 × 50; and an input (4) below the card.
/// The card and the button listen for hover.
fn ui() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create(2)
        .style(2, Prop::Width, px(200.0))
        .style(2, Prop::Height, px(100.0))
        .style(2, Prop::FlexShrink, Value::F32(0.0))
        .listen(2, event_mask::HOVER)
        .create(3)
        .style(3, Prop::Width, px(50.0))
        .style(3, Prop::Height, px(50.0))
        .style(3, Prop::Cursor, Value::Enum(cursor::POINTER))
        .listen(3, event_mask::HOVER | event_mask::PRESS)
        .insert(2, 3, 0)
        .create_input(4)
        .style(4, Prop::Width, px(200.0))
        .style(4, Prop::Height, px(30.0))
        .insert(1, 2, 0)
        .insert(1, 4, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn hover_events(t: &mut Tree) -> Vec<String> {
    t.take_events()
        .into_iter()
        .filter_map(|e| match e {
            TreeEvent::PointerEnter(id) => Some(format!("enter {id}")),
            TreeEvent::PointerLeave(id) => Some(format!("leave {id}")),
            _ => None,
        })
        .collect()
}

#[test]
fn enter_and_leave_in_order_only_for_listeners() {
    let mut t = ui();
    t.take_events();
    t.pointer_at(Some((10.0, 10.0)));
    assert_eq!(hover_events(&mut t), ["enter 2", "enter 3"], "outermost first; the root doesn't listen");
    assert_eq!(t.hovered(), [1, 2, 3]);
    t.pointer_at(Some((20.0, 20.0)));
    assert!(hover_events(&mut t).is_empty(), "moving inside: nothing");
    t.pointer_at(Some((150.0, 50.0)));
    assert_eq!(hover_events(&mut t), ["leave 3"], "off the button, still on the card");
    t.pointer_at(Some((10.0, 10.0)));
    t.take_events();
    t.pointer_at(Some((10.0, 110.0)));
    assert_eq!(hover_events(&mut t), ["leave 3", "leave 2"], "innermost first");
    t.pointer_at(Some((10.0, 10.0)));
    t.take_events();
    t.pointer_at(None);
    assert_eq!(hover_events(&mut t), ["leave 3", "leave 2"], "left the window");
}

#[test]
fn a_node_that_moves_hides_or_goes_away_under_a_still_pointer_is_left() {
    let mut t = ui();
    t.pointer_at(Some((10.0, 10.0)));
    t.take_events();
    // It moves away (a margin pushes the card down).
    t.apply(&{
        let mut o = Ops::new();
        o.style(2, Prop::MarginTop, px(40.0));
        o.bytes()
    })
    .unwrap();
    t.layout();
    assert_eq!(hover_events(&mut t), ["leave 3", "leave 2"]);
    // Back, then hidden.
    t.apply(&{
        let mut o = Ops::new();
        o.style_reset(2, Prop::MarginTop);
        o.bytes()
    })
    .unwrap();
    t.layout();
    assert_eq!(hover_events(&mut t), ["enter 2", "enter 3"]);
    t.apply(&{
        let mut o = Ops::new();
        o.style(3, Prop::Display, Value::Enum(mantou_tree::protocol::display::NONE));
        o.bytes()
    })
    .unwrap();
    t.layout();
    assert_eq!(hover_events(&mut t), ["leave 3"]);
    // Released: no event (there's nothing left to tell), and it's no longer hovered.
    t.apply(&{
        let mut o = Ops::new();
        o.remove(1, 2).release(2);
        o.bytes()
    })
    .unwrap();
    t.layout();
    assert!(hover_events(&mut t).is_empty(), "the input moved up under the pointer, and doesn't listen");
    assert_eq!(t.hovered(), [1, 4]);
}

#[test]
fn scrolling_under_a_still_pointer_moves_the_hover() {
    let mut o = Ops::new();
    o.create(1)
        .create(2)
        .style(2, Prop::Overflow, Value::Enum(overflow::SCROLL))
        .style(2, Prop::Width, px(100.0))
        .style(2, Prop::Height, px(100.0))
        .insert(1, 2, 0)
        .set_root(1);
    for id in 10..15 {
        o.create(id).style(id, Prop::Height, px(50.0)).style(id, Prop::FlexShrink, Value::F32(0.0)).listen(id, event_mask::HOVER).insert(2, id, 0);
    }
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    t.apply(&o.bytes()).unwrap();
    t.layout();
    t.pointer_at(Some((20.0, 20.0)));
    assert_eq!(hover_events(&mut t), ["enter 10"]);
    t.wheel(20.0, 20.0, 0.0, 60.0);
    t.layout();
    assert_eq!(hover_events(&mut t), ["leave 10", "enter 11"]);
}

#[test]
fn a_new_listener_over_the_pointer_hears_it_is_hovered() {
    let mut t = ui();
    t.pointer_at(Some((150.0, 110.0)));
    t.take_events();
    t.apply(&{
        let mut o = Ops::new();
        o.listen(4, event_mask::HOVER);
        o.bytes()
    })
    .unwrap();
    assert_eq!(hover_events(&mut t), ["enter 4"]);
}

#[test]
fn the_cursor_comes_from_the_innermost_node_that_sets_one() {
    let mut t = ui();
    assert_eq!(t.cursor(), cursor::DEFAULT, "nowhere");
    t.pointer_at(Some((10.0, 10.0)));
    assert_eq!(t.cursor(), cursor::POINTER, "the button's");
    t.pointer_at(Some((150.0, 10.0)));
    assert_eq!(t.cursor(), cursor::DEFAULT, "the card sets none");
    t.pointer_at(Some((150.0, 110.0)));
    assert_eq!(t.cursor(), cursor::TEXT, "inputs show the text cursor");
    t.apply(&{
        let mut o = Ops::new();
        o.style(4, Prop::Cursor, Value::Enum(cursor::NOT_ALLOWED)).style(2, Prop::Cursor, Value::Enum(cursor::GRAB));
        o.bytes()
    })
    .unwrap();
    t.layout();
    assert_eq!(t.cursor(), cursor::NOT_ALLOWED, "unless it sets one");
    t.pointer_at(Some((150.0, 10.0)));
    assert_eq!(t.cursor(), cursor::GRAB);
    t.pointer_at(Some((10.0, 10.0)));
    assert_eq!(t.cursor(), cursor::POINTER, "the innermost wins");
}

#[test]
fn transformed_views_are_hovered_where_drawn() {
    let mut o = Ops::new();
    o.create(1)
        .create(2)
        .style(2, Prop::Position, Value::Enum(position::ABSOLUTE))
        .style(2, Prop::Width, px(50.0))
        .style(2, Prop::Height, px(50.0))
        .style(2, Prop::TranslateX, Value::F32(100.0))
        .listen(2, event_mask::HOVER)
        .insert(1, 2, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    t.apply(&o.bytes()).unwrap();
    t.layout();
    t.pointer_at(Some((10.0, 10.0)));
    assert!(hover_events(&mut t).is_empty());
    t.pointer_at(Some((110.0, 10.0)));
    assert_eq!(hover_events(&mut t), ["enter 2"]);
}

#[test]
fn select_places_the_caret_in_utf16_units() {
    let mut o = Ops::new();
    o.create(1).create_input(2).value(2, 0, "a😀bc").insert(1, 2, 0).set_root(1).select(2, 3, 3);
    let mut t = Tree::new();
    t.apply(&o.bytes()).unwrap();
    assert_eq!(t.selection_utf16(2), Some((3, 3)));
    t.apply(&{
        let mut o = Ops::new();
        o.select(2, 0, 99);
        o.bytes()
    })
    .unwrap();
    assert_eq!(t.selection_utf16(2), Some((0, 5)), "clamped");
    let r = t
        .apply(&{
            let mut o = Ops::new();
            o.select(1, 0, 0);
            o.bytes()
        })
        .unwrap();
    assert_eq!(r.errors.len(), 1, "not an input");
}
