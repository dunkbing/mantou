use mantou_tree::protocol::Prop;
use mantou_tree::{Length, Ops, Tree, Value};

const ROW: u32 = 0;

fn tree(ops: &Ops) -> Tree {
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&ops.bytes()).expect("valid");
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

#[test]
fn text_measures_its_content_and_wraps_in_a_narrow_box() {
    let mut o = Ops::new();
    o.create(1).create_text(2).text(2, "Hello").create(3).create_text(4)
        .text(4, "A sentence long enough to wrap in a narrow box")
        .style(3, Prop::Width, px(90.0)).insert(3, 4, 0).insert(1, 2, 0).insert(1, 3, 0).set_root(1);
    let t = tree(&o);
    let hello = t.rect(2).unwrap();
    assert!(hello[3] - hello[1] > 14.0 && hello[3] - hello[1] < 22.0, "one line of 14 px text: {hello:?}");
    let wrapped = t.rect(4).unwrap();
    assert!(wrapped[2] - wrapped[0] <= 90.0);
    assert!(wrapped[3] - wrapped[1] > 3.0 * (hello[3] - hello[1]), "wraps onto 4+ lines: {wrapped:?}");
}

#[test]
fn glyphs_are_drawn_with_the_atlas_and_change_with_the_text() {
    let mut o = Ops::new();
    o.create(1).create_text(2).text(2, "Hi").insert(1, 2, 0).set_root(1);
    let mut t = tree(&o);
    let s = t.scene();
    let glyphs: Vec<_> = s.quads.iter().filter(|q| q.is_glyph()).collect();
    assert_eq!(glyphs.len(), 2);
    assert!(s.atlas.is_some());
    assert_eq!(glyphs[0].color, [0.0, 0.0, 0.0, 1.0], "black by default");
    let mut m = Ops::new();
    m.text(2, "Hello").style(2, Prop::Color, Value::Color(0xff_ff_00_00));
    t.apply(&m.bytes()).unwrap();
    t.layout();
    let s = t.scene();
    let glyphs: Vec<_> = s.quads.iter().filter(|q| q.is_glyph()).collect();
    assert_eq!(glyphs.len(), 5);
    assert_eq!(glyphs[0].color, [0.0, 0.0, 1.0, 1.0]);
    assert_eq!(t.text_of(2), Some("Hello"));
}

#[test]
fn max_lines_one_cuts_off_with_an_ellipsis_inside_its_box() {
    let mut o = Ops::new();
    o.create(1).create(3).style(3, Prop::FlexDirection, Value::Enum(ROW)).style(3, Prop::Width, px(120.0))
        .create_text(2).text(2, "A subject line far too long for the box").style(2, Prop::MaxLines, Value::F32(1.0))
        .style(2, Prop::FlexShrink, Value::F32(1.0))
        .insert(3, 2, 0).insert(1, 3, 0).set_root(1);
    let mut t = tree(&o);
    let r = t.rect(2).unwrap();
    assert!(r[2] - r[0] <= 120.0 + 0.01, "{r:?}");
    let s = t.scene();
    let right = s.quads.iter().filter(|q| q.is_glyph()).map(|q| q.rect[2]).fold(0.0, f32::max);
    assert!(right <= 121.0, "no glyph past the box: {right}");
}

#[test]
fn overflow_hidden_clips_descendants() {
    let mut o = Ops::new();
    o.create(1).create(3).style(3, Prop::Height, px(20.0)).style(3, Prop::Overflow, Value::Enum(1))
        .create_text(2).text(2, "Line one\nLine two\nLine three").insert(3, 2, 0).insert(1, 3, 0).set_root(1);
    let mut t = tree(&o);
    let s = t.scene();
    let glyphs: Vec<_> = s.quads.iter().filter(|q| q.is_glyph()).collect();
    assert!(!glyphs.is_empty());
    assert!(glyphs.iter().all(|q| q.clip == [0.0, 0.0, 400.0, 20.0]), "clipped to the box");
    assert!(glyphs.iter().all(|q| q.rect[1] < 20.0), "glyphs wholly outside are dropped");
    assert_eq!(t.hit(5.0, 40.0), Some(1), "what's clipped away can't be hit");
}

#[test]
fn text_nodes_refuse_children_and_views_refuse_text() {
    let mut o = Ops::new();
    o.create(1).create_text(2).create(3);
    let mut t = tree(&o);
    let mut m = Ops::new();
    m.insert(2, 3, 0).text(1, "nope");
    let r = t.apply(&m.bytes()).unwrap();
    assert_eq!(r.errors.len(), 2, "{:?}", r.errors);
}

#[test]
fn text_layout_scales_with_the_display() {
    let mut o = Ops::new();
    o.create(1).create_text(2).text(2, "Mantou").style(2, Prop::FontSize, Value::F32(20.0)).insert(1, 2, 0).set_root(1);
    let mut t = tree(&o);
    let w1 = t.rect(2).unwrap()[2];
    let g1 = t.scene().quads.iter().filter(|q| q.is_glyph()).map(|q| q.rect[3] - q.rect[1]).fold(0.0, f32::max);
    t.set_viewport(800, 600, 2.0);
    t.layout();
    assert_eq!(t.rect(2).unwrap()[2], w1, "logical layout doesn't change with the scale");
    let g2 = t.scene().quads.iter().filter(|q| q.is_glyph()).map(|q| q.rect[3] - q.rect[1]).fold(0.0, f32::max);
    assert!(g2 > g1 * 1.8, "glyphs are rasterized at device size: {g1} → {g2}");
}

#[test]
fn rounded_corners_and_borders_reach_the_scene_and_borders_inset_content() {
    let mut o = Ops::new();
    o.create(1).create(2).create(3)
        .style(2, Prop::Width, px(100.0)).style(2, Prop::Height, px(40.0))
        .style(2, Prop::BorderRadius, Value::F32(8.0)).style(2, Prop::BorderWidth, Value::F32(2.0))
        .style(2, Prop::BorderColor, Value::Color(0xff_00_00_ff)).style(3, Prop::Height, px(10.0))
        .insert(2, 3, 0).insert(1, 2, 0).set_root(1);
    let mut t = tree(&o);
    assert_eq!(t.rect(3), Some([2.0, 2.0, 98.0, 12.0]), "the border insets the child");
    t.set_viewport(800, 600, 2.0);
    t.layout();
    let s = t.scene();
    assert_eq!(s.quads.len(), 1, "a border alone draws a quad");
    assert_eq!((s.quads[0].radius, s.quads[0].border), (16.0, 4.0), "in device px");
    assert!(s.dump().contains("radius 16 border 4 #ff0000ff"));
}

#[test]
fn a_clipping_box_can_be_smaller_than_its_content() {
    // A 100 px column holding a box of 300 px of content: with overflow hidden,
    // the box shrinks to the column instead of overflowing it.
    let mut o = Ops::new();
    o.create(1).create(2).create(3).create(4)
        .style(2, Prop::Height, px(100.0)).style(3, Prop::FlexGrow, Value::F32(1.0)).style(3, Prop::Overflow, Value::Enum(1))
        .style(4, Prop::Height, px(300.0)).style(4, Prop::FlexShrink, Value::F32(0.0))
        .insert(3, 4, 0).insert(2, 3, 0).insert(1, 2, 0).set_root(1);
    let t = tree(&o);
    assert_eq!(t.rect(3), Some([0.0, 0.0, 400.0, 100.0]));
    assert_eq!(t.rect(4), Some([0.0, 0.0, 400.0, 300.0]));
}
