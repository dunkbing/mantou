//! The fuzzer's bytes drive valid UI mutations (tests/common/model.rs); after
//! each batch, incremental layout must equal layout from scratch, to the bit.
#![no_main]
#[path = "../../crates/mantou-tree/tests/common/model.rs"]
mod model;
use mantou_tree::{Ops, Tree};
use model::{Bytes, Model, Source};

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    let mut src = Bytes(data);
    let mut model = Model::new();
    let mut ops = Ops::new();
    let mut tree = Tree::new();
    let (w, h, s) = model.viewport;
    tree.set_viewport(w, h, s);
    model.seed_tree(&mut ops, &mut src);
    while !src.is_empty() {
        for _ in 0..1 + src.below(6) {
            if let Some((w, h, s)) = model.mutate(&mut ops, &mut src) {
                tree.set_viewport(w, h, s);
            }
        }
        let report = tree.apply(&ops.take()).expect("valid batch");
        assert!(report.errors.is_empty(), "valid ops refused: {:?}", report.errors);
        tree.layout();
        tree.check().expect("consistent tree");
        let mut scratch = Tree::new();
        let (w, h, s) = model.viewport;
        scratch.set_viewport(w, h, s);
        scratch.apply(&model.rebuild()).expect("valid rebuild");
        scratch.layout();
        for &id in model.nodes.keys() {
            let (a, b) = (tree.rect(id), scratch.rect(id));
            let same = match (a, b) {
                (Some(a), Some(b)) => a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()),
                (None, None) => true,
                _ => false,
            };
            assert!(same, "node {id}: incremental {a:?}, from scratch {b:?}");
        }
        assert_eq!(tree.scene(), scratch.scene());
    }
});
