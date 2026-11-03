use mantou_tree::Tree;

/// Builds op batches the way runtime/encoder.ts does.
#[derive(Default)]
struct Ops(Vec<u32>);

impl Ops {
    fn op(&mut self, code: u32, operands: &[u32]) -> &mut Self {
        self.0.push(code | (operands.len() as u32) << 16);
        self.0.extend_from_slice(operands);
        self
    }
    fn create(&mut self, id: u32) -> &mut Self { self.op(1, &[id, 1]) }
    fn insert(&mut self, parent: u32, child: u32, before: u32) -> &mut Self { self.op(2, &[parent, child, before]) }
    fn remove(&mut self, parent: u32, child: u32) -> &mut Self { self.op(3, &[parent, child]) }
    fn release(&mut self, id: u32) -> &mut Self { self.op(4, &[id]) }
    fn px(&mut self, id: u32, prop: u32, v: f32) -> &mut Self { self.op(5, &[id, prop, 0, v.to_bits()]) }
    fn percent(&mut self, id: u32, prop: u32, v: f32) -> &mut Self { self.op(5, &[id, prop, 1, v.to_bits()]) }
    fn enum_(&mut self, id: u32, prop: u32, v: u32) -> &mut Self { self.op(5, &[id, prop, v]) }
    fn color(&mut self, id: u32, rgba: u32) -> &mut Self { self.op(5, &[id, 31, rgba]) }
    fn listen(&mut self, id: u32) -> &mut Self { self.op(9, &[id, 1]) }
    fn root(&mut self, id: u32) -> &mut Self { self.op(10, &[id]) }
    fn bytes(&self) -> Vec<u8> { self.0.iter().flat_map(|w| w.to_le_bytes()).collect() }
}

const WIDTH: u32 = 10;
const HEIGHT: u32 = 11;
const PADDING_TOP: u32 = 16;
const FLEX_DIRECTION: u32 = 2;
const ROW: u32 = 0;
const RED: u32 = 0xff_00_00_ff;

fn tree_with(ops: &Ops) -> Tree {
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&ops.bytes()).expect("valid");
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

#[test]
fn root_fills_the_window_and_children_lay_out_in_a_column() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).px(2, HEIGHT, 50.0).px(3, HEIGHT, 30.0).px(1, PADDING_TOP, 10.0)
        .insert(1, 2, 0).insert(1, 3, 0).root(1);
    let t = tree_with(&o);
    assert_eq!(t.rect(1), Some([0.0, 0.0, 400.0, 300.0]));
    assert_eq!(t.rect(2), Some([0.0, 10.0, 400.0, 60.0]));
    assert_eq!(t.rect(3), Some([0.0, 60.0, 400.0, 90.0]));
}

#[test]
fn row_with_percent_widths() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).enum_(1, FLEX_DIRECTION, ROW).percent(2, WIDTH, 25.0).percent(3, WIDTH, 50.0)
        .insert(1, 2, 0).insert(1, 3, 0).root(1);
    let t = tree_with(&o);
    assert_eq!(t.rect(2), Some([0.0, 0.0, 100.0, 300.0]));
    assert_eq!(t.rect(3), Some([100.0, 0.0, 300.0, 300.0]));
}

#[test]
fn insert_before_moves_and_in_place_insert_is_a_no_op() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).px(2, HEIGHT, 10.0).px(3, HEIGHT, 20.0).insert(1, 2, 0).insert(1, 3, 0).root(1);
    let mut t = tree_with(&o);
    // Move 3 before 2.
    let mut m = Ops::default();
    m.insert(1, 3, 2);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert_eq!(t.rect(3), Some([0.0, 0.0, 400.0, 20.0]));
    assert_eq!(t.rect(2), Some([0.0, 20.0, 400.0, 30.0]));
    // 3 is already before 2: no layout needed.
    let layouts = t.stats().layouts;
    t.apply(&m.bytes()).unwrap();
    assert!(!t.layout(), "an in-place insert must not dirty the layout");
    assert_eq!(t.stats().layouts, layouts);
}

#[test]
fn remove_detaches_and_release_frees() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).insert(1, 2, 0).insert(2, 3, 0).root(1);
    let mut t = tree_with(&o);
    let mut m = Ops::default();
    m.remove(1, 2);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert_eq!(t.rect(2), None, "detached nodes are not laid out");
    assert_eq!(t.node_count(), 3);
    let mut m = Ops::default();
    m.release(2).insert(1, 3, 0);
    let r = t.apply(&m.bytes()).unwrap();
    assert!(r.errors.is_empty(), "the released node's child is detached and reusable: {:?}", r.errors);
    t.layout();
    assert_eq!(t.node_count(), 2);
    assert!(t.rect(3).is_some());
}

#[test]
fn cycles_and_unknown_ids_are_rejected_per_op() {
    let mut o = Ops::default();
    o.create(1).create(2).insert(1, 2, 0).root(1);
    let mut t = tree_with(&o);
    let mut m = Ops::default();
    m.insert(2, 1, 0).insert(1, 99, 0).create(1);
    let r = t.apply(&m.bytes()).unwrap();
    assert_eq!(r.errors.len(), 3, "{:?}", r.errors);
    t.layout();
    assert_eq!(t.rect(2), Some([0.0, 0.0, 400.0, 0.0]));
}

#[test]
fn malformed_batches_change_nothing() {
    let mut t = Tree::new();
    let mut o = Ops::default();
    o.create(1);
    let mut bytes = o.bytes();
    bytes.extend_from_slice(&(5u32 | 9 << 16).to_le_bytes()); // STYLE claiming 9 operands that aren't there
    assert!(t.apply(&bytes).is_err());
    assert_eq!(t.node_count(), 0, "nothing from a malformed batch is applied");
    assert!(t.apply(&[1, 2, 3]).is_err());
}

#[test]
fn scene_snaps_to_device_pixels_and_skips_transparent_nodes() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).px(2, HEIGHT, 10.3).px(3, HEIGHT, 10.0).color(2, RED)
        .insert(1, 2, 0).insert(1, 3, 0).root(1);
    let mut t = tree_with(&o);
    t.set_viewport(600, 450, 1.5);
    t.layout();
    let s = t.scene();
    assert_eq!(s.quads.len(), 1, "only the red node has a background");
    assert_eq!(s.quads[0].rect, [0.0, 0.0, 600.0, 15.0], "10.3 logical px × 1.5 = 15.45 → 15");
    assert_eq!(s.quads[0].color, [1.0, 0.0, 0.0, 1.0]);
    assert_eq!(s.size_px, (600, 450));
}

#[test]
fn press_targets_the_topmost_node_with_a_listener_on_its_path() {
    let mut o = Ops::default();
    o.create(1).create(2).create(3).px(2, HEIGHT, 100.0).px(3, HEIGHT, 50.0)
        .insert(1, 2, 0).insert(2, 3, 0).root(1);
    let mut t = tree_with(&o);
    assert_eq!(t.press_target(10.0, 10.0), None, "nobody listens");
    let mut m = Ops::default();
    m.listen(2);
    t.apply(&m.bytes()).unwrap();
    assert_eq!(t.hit(10.0, 10.0), Some(3));
    assert_eq!(t.press_target(10.0, 10.0), Some(3), "3 is the target; 2 handles it as it bubbles");
    assert_eq!(t.press_target(10.0, 75.0), Some(2));
    assert_eq!(t.press_target(10.0, 200.0), None, "the root has no listener");
}

#[test]
fn shared_styles_apply_and_own_properties_override_them() {
    // STYLE_DEF 1 = { height: 40, backgroundColor: red }
    let mut o = Ops::default();
    o.create(1).create(2).create(3)
        .op(7, &[1, 2, HEIGHT, 0, 40f32.to_bits(), 31, RED])
        .op(8, &[2, 1]).op(8, &[3, 1]).px(3, HEIGHT, 10.0)
        .insert(1, 2, 0).insert(1, 3, 0).root(1);
    let mut t = tree_with(&o);
    assert_eq!(t.rect(2).map(|r| r[3] - r[1]), Some(40.0));
    assert_eq!(t.rect(3).map(|r| r[3] - r[1]), Some(10.0));
    // Redefining the style restyles its users.
    let mut m = Ops::default();
    m.op(7, &[1, 1, HEIGHT, 0, 25f32.to_bits()]);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert_eq!(t.rect(2).map(|r| r[3] - r[1]), Some(25.0));
    assert_eq!(t.scene().quads.len(), 0, "the new definition has no background");
}

#[test]
fn a_huge_style_def_count_is_an_error_not_an_abort() {
    // Found by tests/random.rs: the count was used to reserve memory before it was checked.
    let mut t = Tree::new();
    let bytes: Vec<u8> = [7u32 | 2 << 16, 1, u32::MAX].iter().flat_map(|w| w.to_le_bytes()).collect();
    let e = t.apply(&bytes).unwrap_err();
    assert!(e.message.contains("claims"), "{e}");
}

#[test]
fn right_and_bottom_resolve_against_the_parent_not_the_window() {
    // dunkbing/mantou#1: views default to `position: relative`, so each is the
    // containing block of its absolutely positioned children.
    const POSITION: u32 = 26;
    const ABSOLUTE: u32 = 1;
    const RIGHT: u32 = 28;
    const BOTTOM: u32 = 29;
    let mut o = Ops::default();
    o.create(1).enum_(1, FLEX_DIRECTION, ROW)
        .create(2).px(2, WIDTH, 100.0)
        .create(3).px(3, WIDTH, 200.0).px(3, HEIGHT, 100.0)
        .create(4).enum_(4, POSITION, ABSOLUTE).px(4, RIGHT, 0.0).px(4, BOTTOM, 0.0).px(4, WIDTH, 10.0).px(4, HEIGHT, 10.0)
        .insert(3, 4, 0).insert(1, 2, 0).insert(1, 3, 0).root(1);
    let mut t = Tree::new();
    t.set_viewport(640, 400, 1.0);
    t.apply(&o.bytes()).unwrap();
    t.layout();
    assert_eq!(t.rect(4), Some([290.0, 90.0, 300.0, 100.0]));
}

#[test]
fn layout_listeners_hear_their_box_when_it_changes() {
    use mantou_tree::TreeEvent;
    let layout_listen = |o: &mut Ops, id: u32| {
        o.op(9, &[id, 2]);
    };
    let mut o = Ops::default();
    o.create(1).create(2).px(2, HEIGHT, 50.0).create(3).px(3, HEIGHT, 20.0).insert(1, 2, 0).insert(1, 3, 0).root(1);
    layout_listen(&mut o, 2);
    let mut t = tree_with(&o);
    assert_eq!(t.take_events(), vec![TreeEvent::Layout { id: 2, rect: [0.0, 0.0, 400.0, 50.0] }], "first layout");
    // A change elsewhere that leaves its box alone: nothing.
    let mut m = Ops::default();
    m.px(3, HEIGHT, 30.0);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert!(t.take_events().is_empty());
    // The window resizes: its box changes.
    t.set_viewport(300, 300, 1.0);
    t.layout();
    assert_eq!(t.take_events(), vec![TreeEvent::Layout { id: 2, rect: [0.0, 0.0, 300.0, 50.0] }]);
    // A new listener hears the current box at the next layout, though nothing changed.
    let mut m = Ops::default();
    layout_listen(&mut m, 3);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert_eq!(t.take_events(), vec![TreeEvent::Layout { id: 3, rect: [0.0, 50.0, 300.0, 30.0] }]);
    // Hidden, then shown again with the same box: reported again.
    const DISPLAY: u32 = 1;
    let mut m = Ops::default();
    m.enum_(3, DISPLAY, 1);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert!(t.take_events().is_empty());
    let mut m = Ops::default();
    m.enum_(3, DISPLAY, 0);
    t.apply(&m.bytes()).unwrap();
    t.layout();
    assert_eq!(t.take_events(), vec![TreeEvent::Layout { id: 3, rect: [0.0, 50.0, 300.0, 30.0] }]);
}
