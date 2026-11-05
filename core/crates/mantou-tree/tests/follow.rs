//! FOLLOW_POINTER (dunkbing/mantou#36): a drag's preview moves with the pointer in the core, with no relayout.
use mantou_tree::protocol::{Prop, pointer_events, position};
use mantou_tree::{Length, Ops, Tree, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

/// A 400 × 300 root (1) with a 100 × 40 box (2) at (20, 30) inside a padded view (3); and a preview (4),
/// 80 × 24, fixed at the top left and not under the pointer.
fn ui() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create(3)
        .style(3, Prop::PaddingLeft, px(20.0))
        .style(3, Prop::PaddingTop, px(30.0))
        .create(2)
        .style(2, Prop::Width, px(100.0))
        .style(2, Prop::Height, px(40.0))
        .insert(3, 2, 0)
        .insert(1, 3, 0)
        .create(4)
        .style(4, Prop::Position, Value::Enum(position::FIXED))
        .style(4, Prop::PointerEvents, Value::Enum(pointer_events::NONE))
        .style(4, Prop::Width, px(80.0))
        .style(4, Prop::Height, px(24.0))
        .insert(1, 4, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn apply(t: &mut Tree, o: &mut Ops) {
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
}

#[test]
fn the_node_moves_with_the_pointer_without_a_relayout() {
    let mut t = ui();
    assert_eq!(t.rect(4), Some([0.0, 0.0, 80.0, 24.0]));
    t.pointer_at(Some((50.0, 60.0)));
    apply(&mut t, Ops::new().follow_pointer(4, 10.0, 5.0));
    t.layout();
    assert_eq!(t.rect(4), Some([40.0, 55.0, 120.0, 79.0]), "its grab point under the pointer");
    let layouts = t.stats().layouts;
    for (x, y) in [(60.0, 60.0), (200.0, 150.0), (390.0, 290.0)] {
        assert!(t.pointer_at(Some((x, y))), "boxes to place again");
        assert!(!t.layout(), "placed, not laid out");
        assert_eq!(t.rect(4), Some([x - 10.0, y - 5.0, x + 70.0, y + 19.0]));
    }
    assert_eq!(t.stats().layouts, layouts);
    // The pointer goes through it, and through what's inside it.
    apply(&mut t, Ops::new().create(5).style(5, Prop::Width, px(20.0)).style(5, Prop::Height, px(20.0)).insert(4, 5, 0));
    t.pointer_at(Some((60.0, 40.0)));
    t.layout();
    assert_eq!(t.rect(5), Some([50.0, 35.0, 70.0, 55.0]));
    assert_eq!(t.hit(60.0, 40.0), Some(2));
    // Off again: back where layout put it, and pointer moves place nothing.
    apply(&mut t, Ops::new().follow_pointer(0, 0.0, 0.0));
    t.layout();
    assert_eq!(t.rect(4), Some([0.0, 0.0, 80.0, 24.0]));
    assert!(!t.pointer_at(Some((100.0, 100.0))));
}

#[test]
fn releasing_the_node_stops_it_and_a_bad_id_is_an_error() {
    let mut t = ui();
    t.pointer_at(Some((50.0, 60.0)));
    apply(&mut t, Ops::new().follow_pointer(4, 0.0, 0.0));
    apply(&mut t, Ops::new().remove(1, 4).release(4));
    t.layout();
    assert!(!t.pointer_at(Some((70.0, 70.0))), "nothing follows any more");
    let r = t.apply(&Ops::new().follow_pointer(99, 0.0, 0.0).bytes()).unwrap();
    assert_eq!(r.errors.len(), 1);
    // A node that follows without a pointer (it left the window) stays where layout put it.
    apply(&mut t, Ops::new().follow_pointer(2, 0.0, 0.0));
    t.pointer_at(None);
    t.layout();
    assert_eq!(t.rect(2), Some([20.0, 30.0, 120.0, 70.0]));
}
