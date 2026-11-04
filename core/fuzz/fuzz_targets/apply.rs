//! Any bytes, split into batches: applying, laying out, building the scene and
//! hit-testing never panic, and the tree stays consistent. Between batches,
//! the bytes also drive input (presses, drags, keys, text, the IME), so inputs'
//! editing is fuzzed with whatever the batches built, and the clock moves, so
//! are animations.
#![no_main]
use mantou_tree::protocol::input_flag;
use mantou_tree::{MemoryClipboard, Ops, Tree};

/// A key from a byte: a named key (arrows, Backspace, Enter, Tab…) or ASCII.
fn key(b: u8) -> (u32, Option<String>) {
    if b >= 0xe0 {
        (0x110000 + (b - 0xe0) as u32 % 13, None)
    } else {
        let c = (b % 0x60 + 0x20) as char;
        (c as u32, Some(c.to_string()))
    }
}

libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    let mut tree = Tree::new();
    tree.set_mac_keys(data.first().is_some_and(|b| b & 1 == 1));
    if data.first().is_some_and(|b| b & 2 == 2) {
        // Half the runs start with two inputs, one of them focused, so editing is always reached.
        let mut o = Ops::new();
        o.create(1).create_input(2).create_input(3).input_options(3, input_flag::MULTILINE, 0).value(3, 0, "two\nlines")
            .insert(1, 2, 0).insert(1, 3, 0).set_root(1).focus(2);
        let _ = tree.apply(&o.bytes());
    }
    let mut cb = MemoryClipboard::default();
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
        // Input, from the batch's own bytes.
        if let Some(q) = scene.quads.get(len as usize % scene.quads.len().max(1)) {
            tree.pointer_down(q.rect[0] + 1.0, q.rect[1] + 1.0, 1 + (len % 3) as u32, len & 4 != 0);
            tree.pointer_drag(q.rect[2], q.rect[3]);
            tree.pointer_up();
            tree.pointer_at((len & 8 == 0).then_some((q.rect[2] - 1.0, q.rect[3] - 1.0)));
            let _ = tree.cursor();
        }
        for pair in batch.chunks(2).take(16) {
            let (code, text) = key(pair[0]);
            let mods = pair.get(1).copied().unwrap_or(0) as u32 & 15;
            tree.key(code, text.as_deref(), mods, &mut cb);
        }
        let text = String::from_utf8_lossy(&batch[..batch.len().min(12)]).into_owned();
        match len % 4 {
            0 => {
                tree.insert_text(&text);
            }
            1 => {
                let at = (len as usize) % (text.len() + 1);
                let cursor = text.is_char_boundary(at).then_some((at, at));
                tree.ime_preedit(&text, cursor);
            }
            2 => {
                tree.ime_preedit("", None);
            }
            _ => {}
        }
        let _ = tree.ime_area();
        // The clock moves on by the batch's own amount (animations it started run, end, or are replaced).
        tree.set_time((len as f64) * 37.0 * (1 + rest.len() % 7) as f64);
        tree.tick();
        let _ = tree.take_events();
        tree.layout();
        let _ = tree.scene();
        if let Err(e) = tree.check() {
            panic!("inconsistent tree: {e}");
        }
        rest = tail;
    }
});
