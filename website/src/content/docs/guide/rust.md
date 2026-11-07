---
title: Using Mantou from Rust
description: The native core without JavaScript - nodes, styles and events from a Rust program, in one small executable.
---

Mantou's core is Rust: the layout, text, rendering, input, accessibility and the window are all in `core/`. The TypeScript runtime drives it through a small protocol of ops and events. A Rust program can drive it the same way with the `mantou` crate (`core/crates/mantou`), with no JavaScript and no Bun. The app is a single executable of about 25 MB (11 MB compressed) on Linux, against about 130 MB for an app that carries Bun.

**This is the low-level layer.** You build the UI as a tree of nodes with ops, and you get events back. There are no components, no JSX and no reactivity: those are the TypeScript runtime's. Everything the components do is built from these same ops, so anything they can draw, you can, with more code. The API is new and may change.

## Add it

The crate isn't on crates.io yet. Depend on it from the repository:

```toml
[dependencies]
mantou = { git = "https://github.com/dunkbing/mantou", package = "mantou" }
```

Linux needs the same libraries as a TypeScript app's window (`libxkbcommon-x11-0 libxcursor1 libxi6 libxrandr2`, and a Vulkan or GL driver).

## A counter

```rust
use mantou::{Event, Length, Ops, Value, WindowOptions, protocol::{Prop, align_items, event_mask, justify_content, pointer_events}};

const ROOT: u32 = 1;
const COUNT: u32 = 2;
const BUTTON: u32 = 3;
const LABEL: u32 = 4;

fn main() {
    let options = WindowOptions { title: "Counter".into(), width: 360, height: 240, ..Default::default() };
    std::process::exit(mantou::run(options, |window| {
        // The UI, once. Ids are yours to choose; 0 means none.
        let mut ops = Ops::new();
        ops.create(ROOT)
            .style(ROOT, Prop::FlexGrow, Value::F32(1.0))
            .style(ROOT, Prop::AlignItems, Value::Enum(align_items::CENTER))
            .style(ROOT, Prop::JustifyContent, Value::Enum(justify_content::CENTER))
            .style(ROOT, Prop::RowGap, Value::Length(Length::Px(16.0)))
            .create_text(COUNT)
            .text(COUNT, "0")
            .style(COUNT, Prop::FontSize, Value::F32(40.0))
            .create(BUTTON)
            .style(BUTTON, Prop::Width, Value::Length(Length::Px(120.0)))
            .style(BUTTON, Prop::Height, Value::Length(Length::Px(40.0)))
            .style(BUTTON, Prop::BorderRadius, Value::F32(8.0))
            .style(BUTTON, Prop::BackgroundColor, Value::Color(0xffeb6325)) // RGBA8, red in the low byte: #2563eb
            .listen(BUTTON, event_mask::PRESS)
            .create_text(LABEL)
            .text(LABEL, "+1")
            .style(LABEL, Prop::PointerEvents, Value::Enum(pointer_events::NONE))
            .insert(BUTTON, LABEL, 0)
            .insert(ROOT, COUNT, 0)
            .insert(ROOT, BUTTON, 0)
            .set_root(ROOT);
        window.commit(&mut ops).unwrap();

        let mut count = 0;
        loop {
            for event in window.wait() {
                match event {
                    Event::Press { target: BUTTON, .. } => {
                        count += 1;
                        ops.text(COUNT, &count.to_string());
                    }
                    Event::CloseRequested => return window.quit(0),
                    _ => {}
                }
            }
            window.commit(&mut ops).unwrap(); // what the events changed, in one batch
        }
    }));
}
```

The full example, with colours and a test, is `core/crates/mantou/examples/counter.rs`: `cargo run --release -p mantou --example counter`.

## How it works

- **`mantou::run(options, app)`** opens the window and runs its event loop on the calling thread, which must be the main thread (macOS requires it). `app` runs on a thread of its own with a `Window`; `run` returns the code passed to `window.quit`.
- **`Ops`** builds a batch: `create`, `create_text`, `create_input`, `create_image`, `style` (a `Prop` and a `Value`), `insert` (parent, child, before: 0 appends), `remove`, `release`, `text`, `listen`, `set_root`, `transition`, `animate`, `focus`, `scroll_to` and the rest. `window.commit(&mut ops)` sends it and empties it. Send one batch per change, as the TypeScript runtime does once per turn: the core lays out and draws on its own thread, and a batch that's malformed is rejected whole (`CommitError`).
- **`window.wait()`** blocks until the core has events and returns them in order; `window.events()` takes what's there without blocking.
- **Events** (`Event`): `WindowReady`, `Resized`, `CloseRequested`, `Press`, `PointerDown`/`Up`/`Move`, `KeyDown`/`KeyUp` (a `Key`: a character, or a name like `"ArrowDown"`, with `Modifiers`), `PointerEnter`/`Leave`, `Wheel`, `Layout`, `Scroll`, `Focus`, `Blur`, `Submit`, `TextChanged`, `AnimationEnd`, `ImageLoad`, `ImageError`, `CoreError`, and `Other` for the rest. A node hears an event only if it listens for it (`listen(id, event_mask::PRESS | event_mask::HOVER …)`).
- **A press's target** is the innermost node under the pointer, which can be inside the node that listens (the label in a button). Give labels `pointerEvents: none`, as above, or walk up your own tree.
- **Inputs** keep their text, caret, selection, undo and IME in the core: you hear `TextChanged { rev, text }`, and setting the text yourself is `ops.value(id, rev, text)` with the last `rev` you saw.
- **Styles and values** are the protocol's: `schema/protocol.ts` lists every property with its type (`f32`, a length, a colour as RGBA8 with red in the low byte, an enum), and `mantou::protocol` has the same names in Rust (`Prop`, `align_items`, `event_mask`…). Sizes and coordinates are logical px.

## Testing

`Headless` is the real tree, layout and renderer with no window, on the calling thread, with a clock that moves only when you step it:

```rust
use mantou::{Event, Headless, Ops};

#[test]
fn pressing_the_button_counts() {
    let h = Headless::new(360, 240, 1.0);
    let mut ops = Ops::new();
    build(&mut ops);                       // your UI
    h.commit(&mut ops).unwrap();
    h.step(0.0);
    let [x0, y0, x1, y1] = h.rect(BUTTON).unwrap();
    let events = h.press((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    assert!(events.iter().any(|e| matches!(e, Event::Press { target: BUTTON, .. })));
}
```

`h.press(x, y)`, `h.key(code, mods)`, `h.step(ms)` (animations), `h.rect(id)` (a node's box as drawn) and `h.scene()` (what's drawn, as text) cover most tests.

## Shipping

`cargo build --profile dist` (the profile in `core/Cargo.toml`, with link-time optimization) gives the smallest executable. It's one file: no core library beside it and no runtime to install. `mantou package` doesn't wrap Rust apps yet; for now use your platform's tools (`cargo-bundle`, an AppImage, an installer).

## What's not there yet

Compared with the TypeScript runtime: no components (Button, Table, TreeView… are TypeScript), no `mantou dev` reloads, no `mantou snap`, and platform services (dialogs, menus, notifications, the tray) are only reachable through the raw `mt_service` JSON calls, not a Rust API. One window: `openWindow` has no Rust counterpart yet.
