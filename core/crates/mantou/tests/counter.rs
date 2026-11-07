//! The Rust counter example, headless: presses reach it as events, and its ops change what's drawn.
#[path = "../examples/counter.rs"]
mod counter;

use mantou::{Event, Headless, Ops};

#[test]
fn pressing_the_button_counts() {
    let h = Headless::new(360, 240, 1.0);
    let mut ops = Ops::new();
    counter::build(&mut ops);
    h.commit(&mut ops).unwrap();
    h.step(0.0);
    let [x0, y0, x1, y1] = h.rect(3).expect("the button is laid out");
    let mut count = 0;
    for _ in 0..3 {
        let events = h.press((x0 + x1) / 2.0, (y0 + y1) / 2.0);
        assert!(events.iter().any(|e| matches!(e, Event::Press { target: 3, .. })), "{events:?}");
        for e in &events {
            counter::update(&mut count, e, &mut ops);
        }
        h.commit(&mut ops).unwrap();
    }
    assert_eq!(count, 3);
    // The count's text is drawn wider than "0" was: "3" is laid out (its box is the text's).
    assert!(h.rect(2).is_some());
    assert!(h.scene().contains("quad"), "{}", h.scene());
}

#[test]
fn keys_arrive_named() {
    let h = Headless::new(100, 100, 1.0);
    let mut ops = Ops::new();
    ops.create(1).set_root(1);
    h.commit(&mut ops).unwrap();
    let events = h.key(mantou::protocol::named_key::ARROW_DOWN, Default::default());
    assert!(events.contains(&Event::KeyDown { key: mantou::Key::Named("ArrowDown"), repeat: false, mods: Default::default() }), "{events:?}");
    let events = h.key('k' as u32, mantou::Modifiers { ctrl: true, ..Default::default() });
    assert!(events.iter().any(|e| matches!(e, Event::KeyDown { key: mantou::Key::Char('k'), mods, .. } if mods.ctrl)), "{events:?}");
}
