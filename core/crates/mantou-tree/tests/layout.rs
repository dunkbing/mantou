//! Incremental layout must equal layout from scratch (design §12.4): random
//! valid mutations are applied frame after frame, and after each frame the
//! tree is compared with a new tree built from the expected state. Boxes and
//! scenes must match exactly, to the bit.

mod common;
use common::model::{Model, Rng, Source};
use mantou_tree::{Ops, Tree};

fn from_scratch(model: &Model) -> Tree {
    let mut t = Tree::new();
    let (w, h, s) = model.viewport;
    t.set_viewport(w, h, s);
    let r = t.apply(&model.rebuild()).expect("the rebuild batch is valid");
    assert!(r.errors.is_empty(), "rebuild refused ops: {:?}", r.errors);
    t.layout();
    t
}

/// A scene without what depends on the order glyphs were rasterized in: the
/// atlas, and where in it each glyph sits (its size stays).
type Comparable = ([f32; 4], [f32; 4], [f32; 2], [f32; 4], [f32; 2], [f32; 4]);
fn comparable(s: &mantou_tree::Scene) -> Vec<Comparable> {
    s.quads.iter().map(|q| (q.rect, q.color, [q.uv[2] - q.uv[0], q.uv[3] - q.uv[1]], q.clip, [q.radius, q.border], q.border_color)).collect()
}

fn compare(seed: u64, frame: usize, incremental: &mut Tree, model: &Model, batch: &[u8]) {
    incremental.layout();
    let mut scratch = from_scratch(model);
    for &id in model.nodes.keys() {
        let (a, b) = (incremental.rect(id), scratch.rect(id));
        let same = match (a, b) {
            (Some(a), Some(b)) => a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()),
            (None, None) => true,
            _ => false,
        };
        assert!(
            same,
            "seed {seed}, frame {frame}: node {id} is at {a:?} incrementally but {b:?} from scratch\nlast batch: {:?}",
            mantou_tree::decode(batch)
        );
    }
    assert_eq!(comparable(&incremental.scene()), comparable(&scratch.scene()), "seed {seed}, frame {frame}: scenes differ");
}

fn run(seeds: std::ops::Range<u64>, frames: usize) {
    for seed in seeds {
        let mut rng = Rng::new(seed);
        let mut model = Model::new();
        let mut ops = Ops::new();
        let mut tree = Tree::new();
        let (w, h, s) = model.viewport;
        tree.set_viewport(w, h, s);
        model.seed_tree(&mut ops, &mut rng);
        for frame in 0..frames {
            for _ in 0..1 + rng.below(6) {
                if let Some((w, h, s)) = model.mutate(&mut ops, &mut rng) {
                    tree.set_viewport(w, h, s);
                }
            }
            let batch = ops.take();
            let report = tree.apply(&batch).unwrap();
            assert!(report.errors.is_empty(), "seed {seed}: {:?}", report.errors);
            // Layout only some frames, so several batches pile up between layouts too.
            if rng.chance(70) || frame + 1 == frames {
                compare(seed, frame, &mut tree, &model, &batch);
            }
        }
    }
}

#[test]
fn incremental_layout_matches_layout_from_scratch() {
    run(0..400, 40);
}

#[test]
fn incremental_layout_matches_on_long_runs() {
    run(1000..1010, 400);
}

/// A style change that doesn't move anything (a colour, opacity) only draws again; one that does (a width, a font
/// size) lays out again, and only then.
#[test]
fn paint_only_style_changes_lay_nothing_out() {
    use mantou_tree::protocol::Prop;
    use mantou_tree::{Length, Ops, Tree, Value};
    let px = |v: f32| Value::Length(Length::Px(v));
    let mut o = Ops::new();
    o.create(1).create(2).style(2, Prop::Width, px(50.0)).style(2, Prop::Height, px(20.0)).insert(1, 2, 0);
    o.create_text(3).text(3, "Hello").insert(1, 3, 0).set_root(1);
    let mut t = Tree::new();
    t.set_viewport(200, 200, 1.0);
    t.apply(&o.bytes()).unwrap();
    t.layout();
    t.scene();
    let layouts = t.stats().layouts;
    let text_before = t.rect(3).unwrap();
    t.apply(&Ops::new().style(2, Prop::BackgroundColor, Value::Color(0xff0000ff)).style(3, Prop::Opacity, Value::F32(0.5)).bytes()).unwrap();
    t.layout();
    assert_eq!(t.stats().layouts, layouts, "colours and opacity: no layout");
    assert!(t.scene_stale(), "but drawn again");
    t.apply(&Ops::new().style(2, Prop::Width, px(80.0)).bytes()).unwrap();
    t.layout();
    assert_eq!(t.stats().layouts, layouts + 1, "a width: laid out");
    assert_eq!(t.rect(2).unwrap()[2], 80.0);
    t.apply(&Ops::new().style(3, Prop::FontSize, Value::F32(28.0)).bytes()).unwrap();
    t.layout();
    assert_eq!(t.stats().layouts, layouts + 2, "a font size: measured and laid out");
    assert!(t.rect(3).unwrap()[3] - t.rect(3).unwrap()[1] > text_before[3] - text_before[1], "the text grew");
}
