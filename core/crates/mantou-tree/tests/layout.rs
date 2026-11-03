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

fn compare(seed: u64, frame: usize, incremental: &mut Tree, model: &Model, batch: &[u8]) {
    incremental.layout();
    let scratch = from_scratch(model);
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
    assert_eq!(incremental.scene(), scratch.scene(), "seed {seed}, frame {frame}: scenes differ");
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
