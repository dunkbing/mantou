//! Any bytes, split into batches: applying, laying out, building the scene and
//! hit-testing never panic, and the tree stays consistent.
#![no_main]
use mantou_tree::Tree;

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    let mut tree = Tree::new();
    let mut rest = data;
    while let Some((&len, tail)) = rest.split_first() {
        let n = (len as usize * 4).min(tail.len());
        let (batch, tail) = tail.split_at(n);
        let _ = tree.apply(batch);
        tree.layout();
        let scene = tree.scene();
        for q in &scene.quads {
            let _ = tree.press_target(q.rect[0], q.rect[1]);
        }
        if let Err(e) = tree.check() {
            panic!("inconsistent tree: {e}");
        }
        rest = tail;
    }
});
