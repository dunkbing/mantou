//! App fonts: FONT registers a font file, FONT_FAMILY names a family list,
//! and fontFamily picks one. The test font is monospace, so "iiii" and
//! "MMMM" are the same width in it and not in Inter.
use mantou_tree::protocol::Prop;
use mantou_tree::{Ops, Tree, Value};

const MONO: &[u8] = include_bytes!("../../../../tests/fonts/MantouTestMono.ttf");

fn width(t: &Tree, id: u32) -> f32 {
    let r = t.rect(id).unwrap();
    r[2] - r[0]
}

/// A row of two texts (2: "iiii", 3: "MMMM") in family 1, defined as `names`.
fn tree(names: &str) -> Tree {
    let mut o = Ops::new();
    o.create(1).style(1, Prop::AlignItems, Value::Enum(1)).font_family(1, names);
    for (id, text) in [(2, "iiii"), (3, "MMMM")] {
        o.create_text(id).text(id, text).style(id, Prop::FontFamily, Value::Family(1)).insert(1, id, 0);
    }
    o.set_root(1);
    let mut t = Tree::new();
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

#[test]
fn a_registered_font_is_used_by_its_family_name() {
    let mut t = tree("Mantou Test Mono");
    // Not registered yet: the family falls back to Inter, where M is much wider than i.
    assert!(width(&t, 3) > 2.0 * width(&t, 2));
    let mut o = Ops::new();
    o.font(MONO);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    // Registered: the text is measured again, in the monospace font.
    assert!((width(&t, 2) - width(&t, 3)).abs() < 0.5, "{} vs {}", width(&t, 2), width(&t, 3));
    assert!(t.scene().quads.iter().filter(|q| q.is_glyph()).count() == 8);
}

#[test]
fn the_list_falls_back_in_order_and_bad_data_is_an_error() {
    let mut t = tree("No Such Font, Mantou Test Mono");
    let mut o = Ops::new();
    o.font(MONO).font(b"not a font");
    let r = t.apply(&o.bytes()).unwrap();
    assert_eq!(r.errors.len(), 1, "{:?}", r.errors);
    t.layout();
    assert!((width(&t, 2) - width(&t, 3)).abs() < 0.5, "the second family in the list");
    // Back to the default fonts.
    let mut o = Ops::new();
    o.style(2, Prop::FontFamily, Value::Family(0)).style(3, Prop::FontFamily, Value::Family(0));
    t.apply(&o.bytes()).unwrap();
    t.layout();
    assert!(width(&t, 3) > 2.0 * width(&t, 2));
}
