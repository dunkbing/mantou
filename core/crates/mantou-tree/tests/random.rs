//! Fuzz-style tests that run on stable Rust in every CI run: random and
//! corrupted batches never panic the decoder or the tree, and the tree stays
//! consistent. core/fuzz explores the same ground with coverage guidance.

mod common;
use common::model::{Model, Rng, Source};
use mantou_tree::{Tree, decode};

/// Words that look like ops often enough to get past the first check.
fn random_batch(rng: &mut Rng) -> Vec<u8> {
    let mut w = Vec::new();
    for _ in 0..rng.below(24) {
        let code = rng.below(16);
        let n = if rng.chance(80) { rng.below(8) } else { rng.below(64) };
        w.push(code | n << 16);
        for _ in 0..n {
            // Mostly small numbers (ids, codes, units), sometimes anything.
            w.push(if rng.chance(70) { rng.below(40) } else { rng.u32() });
        }
    }
    if rng.chance(10) {
        w.truncate(rng.below(w.len() as u32 + 1) as usize);
    }
    w.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn exercise(tree: &mut Tree, rng: &mut Rng) {
    tree.layout();
    let _ = tree.scene();
    for _ in 0..4 {
        let (x, y) = (rng.below(1200) as f32 - 100.0, rng.below(900) as f32 - 100.0);
        let _ = tree.press_target(x, y);
    }
}

#[test]
fn random_bytes_never_panic_and_leave_the_tree_consistent() {
    let mut rng = Rng::new(1);
    let mut tree = Tree::new();
    for i in 0..20_000 {
        let mut bytes = random_batch(&mut rng);
        if rng.chance(5) {
            bytes.push(rng.u32() as u8); // not a multiple of 4
        }
        let _ = decode(&bytes);
        let _ = tree.apply(&bytes);
        if i % 50 == 0 {
            exercise(&mut tree, &mut rng);
        }
        tree.check().unwrap_or_else(|e| panic!("batch {i}: {e}"));
    }
}

#[test]
fn corrupted_valid_batches_never_panic() {
    let mut rng = Rng::new(2);
    for round in 0..3_000 {
        let mut model = Model::new();
        let mut ops = mantou_tree::Ops::new();
        model.seed_tree(&mut ops, &mut rng);
        for _ in 0..20 {
            model.mutate(&mut ops, &mut rng);
        }
        let mut bytes = ops.take();
        match rng.below(3) {
            0 => {
                for _ in 0..1 + rng.below(4) {
                    let i = rng.below(bytes.len() as u32) as usize;
                    bytes[i] ^= 1 << rng.below(8);
                }
            }
            1 => bytes.truncate(rng.below(bytes.len() as u32) as usize),
            _ => {
                let i = rng.below(bytes.len() as u32) as usize & !3;
                bytes.splice(i..i, (rng.u32()).to_le_bytes());
            }
        }
        let mut tree = Tree::new();
        let _ = tree.apply(&bytes);
        exercise(&mut tree, &mut rng);
        tree.check().unwrap_or_else(|e| panic!("round {round}: {e}"));
    }
}

#[test]
fn valid_mutation_sequences_apply_without_errors() {
    let mut rng = Rng::new(3);
    for seed in 0..300 {
        let mut model = Model::new();
        let mut ops = mantou_tree::Ops::new();
        let mut tree = Tree::new();
        model.seed_tree(&mut ops, &mut rng);
        for frame in 0..30 {
            for _ in 0..1 + rng.below(8) {
                if let Some((w, h, s)) = model.mutate(&mut ops, &mut rng) {
                    tree.set_viewport(w, h, s);
                }
            }
            let report = tree.apply(&ops.take()).unwrap();
            assert!(report.errors.is_empty(), "seed {seed} frame {frame}: valid ops were refused: {:?}", report.errors);
            exercise(&mut tree, &mut rng);
            tree.check().unwrap_or_else(|e| panic!("seed {seed} frame {frame}: {e}"));
            assert_eq!(tree.ids(), model.nodes.keys().copied().collect::<Vec<_>>(), "seed {seed} frame {frame}: nodes");
            assert_eq!(tree.root(), model.root, "seed {seed} frame {frame}: root");
        }
    }
}
