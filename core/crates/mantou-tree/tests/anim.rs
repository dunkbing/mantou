//! Animations in the core: transitions, ANIMATE, the transform, the clock.
use mantou_tree::protocol::{Prop, animate_flag, easing, event_mask};
use mantou_tree::{Length, Ops, Tree, TreeEvent, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

/// A 400 × 300 root (1) holding a 100 × 100 red box (2) at (50, 50), with a 20 × 20 child (3) at its top left.
fn scene_with(extra: impl FnOnce(&mut Ops)) -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create(2)
        .style(2, Prop::Position, Value::Enum(mantou_tree::protocol::position::ABSOLUTE))
        .style(2, Prop::Left, px(50.0))
        .style(2, Prop::Top, px(50.0))
        .style(2, Prop::Width, px(100.0))
        .style(2, Prop::Height, px(100.0))
        .style(2, Prop::BackgroundColor, Value::Color(0xff0000ff))
        .create(3)
        .style(3, Prop::Width, px(20.0))
        .style(3, Prop::Height, px(20.0))
        .style(3, Prop::BackgroundColor, Value::Color(0xffff0000))
        .insert(2, 3, 0)
        .insert(1, 2, 0)
        .set_root(1);
    extra(&mut o);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t.scene();
    t
}

fn apply(t: &mut Tree, at: f64, f: impl FnOnce(&mut Ops)) {
    let mut o = Ops::new();
    f(&mut o);
    t.set_time(at);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
}

/// Ticks the clock to `at` and lays out; returns whether anything still animates.
fn tick(t: &mut Tree, at: f64) -> bool {
    t.set_time(at);
    let more = t.tick();
    t.layout();
    more
}

/// The colour of the box's quad (the first one drawn: it's under its child).
fn box_color(t: &mut Tree) -> Option<[f32; 4]> {
    t.scene().quads.iter().find(|q| q.rect == t.rect(2).unwrap()).map(|q| q.color)
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.01
}

#[test]
fn a_transition_animates_a_change_and_ends_at_the_style() {
    let mut t = scene_with(|o| {
        o.transition(2, Prop::Opacity, 100.0, easing::LINEAR);
    });
    assert!(!t.is_animating());
    apply(&mut t, 1000.0, |o| {
        o.style(2, Prop::Opacity, Value::F32(0.0));
    });
    assert!(t.is_animating(), "the change starts a transition");
    assert_eq!(box_color(&mut t).unwrap()[3], 1.0, "it starts where it was drawn");
    assert!(tick(&mut t, 1050.0));
    assert!(close(box_color(&mut t).unwrap()[3], 0.5), "halfway: {:?}", box_color(&mut t));
    assert!(!tick(&mut t, 1100.0), "done");
    assert_eq!(box_color(&mut t), None, "at the style's value (transparent: not drawn)");
    assert!(t.take_events().iter().all(|e| !matches!(e, TreeEvent::AnimationEnd { .. })), "transitions end quietly");
}

#[test]
fn no_transition_on_a_nodes_first_look_or_without_one() {
    // Set with the transition in the batch that creates the node: never drawn, nothing to start from.
    let mut t = scene_with(|o| {
        o.transition(2, Prop::Opacity, 100.0, easing::LINEAR).style(2, Prop::Opacity, Value::F32(0.5));
    });
    assert!(!t.is_animating());
    // A property without a transition changes at once.
    apply(&mut t, 0.0, |o| {
        o.style(2, Prop::BackgroundColor, Value::Color(0xff00ff00));
    });
    assert!(!t.is_animating());
    // Duration 0 turns a transition off.
    apply(&mut t, 0.0, |o| {
        o.transition(2, Prop::Opacity, 0.0, 0).style(2, Prop::Opacity, Value::F32(1.0));
    });
    assert!(!t.is_animating());
}

#[test]
fn a_new_target_mid_transition_starts_from_what_is_drawn() {
    let mut t = scene_with(|o| {
        o.transition(2, Prop::TranslateX, 100.0, easing::LINEAR);
    });
    apply(&mut t, 0.0, |o| {
        o.style(2, Prop::TranslateX, Value::F32(100.0));
    });
    tick(&mut t, 50.0);
    assert_eq!(t.rect(2).unwrap()[0], 100.0, "halfway to +100");
    apply(&mut t, 50.0, |o| {
        o.style(2, Prop::TranslateX, Value::F32(0.0));
    });
    assert_eq!(t.rect(2).unwrap()[0], 100.0, "no jump");
    tick(&mut t, 100.0);
    assert_eq!(t.rect(2).unwrap()[0], 75.0, "halfway back from +50");
    assert!(!tick(&mut t, 150.0));
    assert_eq!(t.rect(2).unwrap()[0], 50.0);
}

#[test]
fn animate_runs_its_iterations_then_reports_the_end() {
    let mut t = scene_with(|_| {});
    apply(&mut t, 0.0, |o| {
        o.animate(2, 7, Prop::TranslateY, 0f32.to_bits(), 40f32.to_bits(), 100.0, easing::LINEAR, 2.0, animate_flag::ALTERNATE);
    });
    assert!(t.is_animating());
    assert_eq!(t.rect(2).unwrap()[1], 50.0);
    tick(&mut t, 50.0);
    assert_eq!(t.rect(2).unwrap()[1], 70.0, "forwards");
    tick(&mut t, 125.0);
    assert_eq!(t.rect(2).unwrap()[1], 80.0, "then backwards");
    assert_eq!(t.rect(3).unwrap()[1], 80.0, "children move with it");
    assert!(t.take_events().is_empty());
    assert!(!tick(&mut t, 200.0));
    assert_eq!(t.rect(2).unwrap()[1], 50.0, "back to its style");
    assert_eq!(t.take_events(), vec![TreeEvent::AnimationEnd { id: 2, animation: 7 }]);
}

#[test]
fn a_new_animation_of_a_property_replaces_the_old_one() {
    let mut t = scene_with(|_| {});
    let forever = f32::INFINITY;
    apply(&mut t, 0.0, |o| {
        o.animate(2, 1, Prop::Opacity, 1f32.to_bits(), 0f32.to_bits(), 100.0, easing::EASE, forever, 0);
        o.animate(2, 2, Prop::BackgroundColor, 0xff0000ff, 0xffff0000, 100.0, easing::LINEAR, forever, 0);
    });
    tick(&mut t, 10_050.0);
    let c = box_color(&mut t).unwrap();
    assert!(close(c[0], 0.5) && close(c[2], 0.5), "a colour halfway: {c:?}");
    assert!(t.is_animating(), "forever");
    apply(&mut t, 10_050.0, |o| {
        o.animate(2, 3, Prop::Opacity, 0f32.to_bits(), 0f32.to_bits(), 0.0, 0, 1.0, 0);
    });
    assert_eq!(t.take_events(), vec![TreeEvent::AnimationEnd { id: 2, animation: 1 }]);
    tick(&mut t, 10_060.0);
    assert_eq!(t.take_events(), vec![TreeEvent::AnimationEnd { id: 2, animation: 3 }], "zero length: ends at the next tick");
    assert!(t.is_animating(), "the colour still runs");
}

#[test]
fn scale_draws_about_the_centre_and_hit_tests_where_drawn() {
    let mut t = scene_with(|o| {
        o.style(2, Prop::Scale, Value::F32(2.0)).style(2, Prop::BorderRadius, Value::F32(4.0));
    });
    assert_eq!(t.rect(2), Some([0.0, 0.0, 200.0, 200.0]), "100 × 100 at (50, 50), doubled about (100, 100)");
    assert_eq!(t.rect(3), Some([0.0, 0.0, 40.0, 40.0]), "its child doubles too");
    assert_eq!(t.hit(190.0, 190.0), Some(2), "hit where it's drawn");
    let scene = t.scene();
    let q = scene.quads.iter().find(|q| q.rect == [0.0, 0.0, 200.0, 200.0]).unwrap();
    assert_eq!(q.radius, 8.0, "the radius scales too");
    // A translation composes with it.
    apply(&mut t, 0.0, |o| {
        o.style(2, Prop::TranslateX, Value::F32(10.0)).style(3, Prop::Scale, Value::F32(0.5));
    });
    assert_eq!(t.rect(2), Some([10.0, 0.0, 210.0, 200.0]));
    assert_eq!(t.rect(3), Some([20.0, 10.0, 40.0, 30.0]), "half of 40 about its centre");
}

#[test]
fn transforms_dont_move_layout_listeners_boxes() {
    let mut t = scene_with(|o| {
        o.listen(2, event_mask::LAYOUT);
    });
    t.take_events();
    apply(&mut t, 0.0, |o| {
        o.animate(2, 1, Prop::TranslateX, 0f32.to_bits(), 100f32.to_bits(), 100.0, easing::LINEAR, 1.0, 0);
    });
    for ms in [10.0, 20.0, 50.0] {
        tick(&mut t, ms);
    }
    assert_eq!(t.rect(2).unwrap()[0], 100.0);
    assert!(t.take_events().is_empty(), "the layout didn't change, only how it's drawn");
}

#[test]
fn a_released_node_stops_animating() {
    let mut t = scene_with(|_| {});
    apply(&mut t, 0.0, |o| {
        o.animate(3, 1, Prop::Opacity, 0f32.to_bits(), 1f32.to_bits(), 100.0, easing::LINEAR, f32::INFINITY, 0);
    });
    assert!(t.is_animating());
    apply(&mut t, 0.0, |o| {
        o.remove(2, 3).release(3);
    });
    assert!(!t.is_animating());
    assert!(!tick(&mut t, 50.0));
}

#[test]
fn only_animatable_properties() {
    let mut t = scene_with(|_| {});
    let mut o = Ops::new();
    o.transition(2, Prop::Width, 100.0, 0).animate(2, 1, Prop::Width, 0, 0, 100.0, 0, 1.0, 0);
    let r = t.apply(&o.bytes()).unwrap();
    assert_eq!(r.errors.len(), 2, "{:?}", r.errors);
    assert!(!t.is_animating());
}
