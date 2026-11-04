---
title: "Testing"
description: "How Mantou and apps built with it are tested: headless mode, the app test API, window mode, CI and benchmarks."
---

## 12. Testing

Testing covers two things:
1. **Mantou itself.** Every layer, from the op decoder to signed packages.
2. **Apps built with it.** The test API is part of the product. Mantou uses it to test itself, so it gets exercised constantly.

### 12.1 Principles

- **Never sleep and then check.** Wait for the condition or event itself (`waitFor`). A global guard of about a minute only turns a hang into a failure that names what never happened. Timeouts are never tuned to make a test pass.
- **Time is controlled.** Headless apps run on a manual clock that moves only when the test says so (`app.clock.advance(ms)`). Animations, debounces, double-clicks, long presses and Mantou's `after()` timers all read it. No test depends on how fast the machine is.
  - **JS side:** `open()` turns on `bun:test`'s fake timers. Verified in Bun 1.4.4: they cover `setTimeout`, `setInterval`, `Date` and `performance.now`.
  - **Native side:** the core's clock is advanced through `mt_test_step`.
  - `app.clock.advance(ms)` moves both together, so JS timers and native animations stay in step. Bun has no `requestAnimationFrame`, so Mantou's animation-frame API reads the core's clock.
- **Every step settles.** Each action (`press`, `type`, `scroll`, …) runs until the app is idle at the current clock time: no queued ops, events or due timers, and no request in flight.
- **Measure counts in tests, time in benchmarks.** Tests assert ops per update, FFI calls per turn, layouts, text measurements, frames drawn and wake-ups. Wall-clock time is measured only by benchmarks, which are tracked over time ([§12.7](/design/testing/#127-benchmarks-tracked-not-gating)).
- **Query the way users and assistive technology see the app.** Find elements by role and accessible name, or by visible text, before falling back to test ids. A control a test can't find by role probably can't be found by a screen reader either.
- **Use one test API in two modes.** The same test file runs headless (fast, in-process, the default) or against a real window (`--target window`), through one driver interface.

### 12.2 Headless mode (core support)

The core runs without winit or a GPU surface. The tree, layout, text, scene building, hit-testing, focus, scrolling, animation and the AccessKit tree are all platform-independent ([§6.2](/design/native-core/#62-layout-of-the-cores-code)), so only the platform layer is swapped out.

This makes the core **multi-instance**: every ABI function takes an instance handle, and there are no global singletons. This also enables embedding several surfaces in one app. [§6.3](/design/native-core/#63-c-abi) changes accordingly: `mt_run` creates the app instance, and the functions below create headless ones.

**As built (C ABI version 3).** Handles are `u32`, every per-UI function (`mt_commit`, `mt_take_events`, `mt_stats`, `mt_set_wake`) takes one, and the window is the instance `mt_app()` returns. The design's buffer-based `mt_test_input` and `mt_test_query` became scalar calls for now; they grow when keys, text and accessibility queries arrive.

```c
uint32_t mt_headless_new(uint32_t width_px, uint32_t height_px, float scale);
void     mt_headless_free(uint32_t inst);
void     mt_test_input(uint32_t inst, uint32_t kind, float x, float y);       // pointer down / up / move, logical px
void     mt_test_viewport(uint32_t inst, uint32_t w_px, uint32_t h_px, float scale);
uint32_t mt_test_step(uint32_t inst, double advance_ms);                  // advance the manual clock; bit 0 = events waiting, bit 1 = layout ran
uint32_t mt_test_hit(uint32_t inst, float x, float y);                    // topmost node, or 0
int32_t  mt_test_node_rect(uint32_t inst, uint32_t id, float* out4);       // laid-out box, logical px
uint32_t mt_test_scene(uint32_t inst, uint8_t* out, uint32_t cap);        // text dump of the scene, for snapshots
int32_t  mt_test_capture(uint32_t inst, uint8_t* rgba, uint32_t cap);     // offscreen render (wgpu, software adapter OK)
uint32_t mt_stats(uint32_t inst, uint64_t* out, uint32_t cap);            // counters: frames, commits, wakes, events, resizes, …
```

`runtime/headless.ts` wraps them as `HeadlessCore` (`step`, `press`, `pointer`, `key`, `wheel`, `type`, `insertText`, `compose`, `clipboard`, `value`, `focused`, `rect`, `hit`, `resize`, `scene`, `capture`, `stats`), which the app test API of §12.3 will build on.

**No Worker in headless mode.** There's no native event loop to own the main thread, so the app runs on the test's own thread. `mt_commit` is synchronous, and events are collected with `mt_take_events` right after each `mt_test_input` and `mt_test_step`. Tests are therefore deterministic and single-threaded.

The real threading model is covered by the window-mode tests ([§12.5](/design/testing/#125-window-mode-the-real-threading-model-and-platform-layer)).

**Reference images** (`mantou-ui/images`, [#11](https://github.com/dunkbing/mantou/issues/11)): `import "mantou-ui/images"` registers a `toMatchImage(name, { threshold, maxDiffRatio })` matcher for `bun test`, which compares a capture with `tests/images/<name>.png` (or under `MANTOU_IMAGES`). A pixel differs when a channel is off by more than `threshold` (default 24 of 255), and the image matches while at most `maxDiffRatio` of its pixels differ (default 0.2%): enough for the edge differences between lavapipe, WARP and Metal, not for a shape moved by a pixel. Run with `MANTOU_UPDATE_IMAGES=1` to write or refresh the goldens, then look at them before committing. A missing golden is written locally and fails in CI. On a mismatch the matcher writes `<name>.actual.png` and `<name>.diff.png` (differences in red) under `tests/images/__failures__/`, which CI uploads as an artifact. `tests/images.test.tsx` covers the counter, the to-do example, a text sampler and boxes (radii, borders, opacity, clipping, a scrollbar), at scale 1 and 2; growing every rounded edge by one pixel in the shader fails it.

### 12.3 The app test API (`mantou-ui/test`)

It's built on **`bun:test`**: Jest-compatible, with `describe`, hooks, `expect.extend`, snapshots and `--coverage` included. We don't have to write our own test runner, matchers or value equality.

```tsx
import { test, expect } from "bun:test";
import { open } from "mantou-ui/test";
import { App } from "./App";

test("adds a todo", async () => {
  const app = await open(<App />, {
    size: [800, 600], scale: 2, colorScheme: "dark", locale: "en-US",
    fetch: { "GET https://api.test/quote": { json: { text: "Hi" } } },   // stubbed; unmatched requests fail the test
    storage: { todos: '["Walk"]' },
  });

  await app.waitFor({ text: "Hi" });
  await app.type({ role: "textbox", name: "What to do?" }, "Buy milk\n");
  await app.press({ role: "button", name: "Add" });

  expect(app.texts()).toContain("2 left");
  expect(app.get({ role: "textbox", name: "What to do?" }).value).toBe("");
  expect(app.lastStep.ops).toBeLessThanOrEqual(6);        // granularity check
  expect(await app.capture()).toMatchImage("todo-added");   // custom matcher, tolerance per pixel
});
```

| Area | API |
|---|---|
| Open | `open(<Component/>)` or `open("./App.tsx")`; options: size, scale, colour scheme, locale, reduced motion, platform to emulate (`"macos"` key bindings etc.), fonts, `fetch` routes, storage |
| Query | `get(q)`, `getAll(q)`, `find(q)`, `shows(q)`, `texts()`, `focused()`. `q` = `{ role, name }` \| `{ text }` \| `{ label }` \| `{ testId }` |
| Act | `press`, `longPress`, `hover`, `type` (text + `\n`), `key("Mod+S")`, `compose` (IME: marked text, then commit), `scroll`, `drag`, `dropFiles`, `resize`, `setColorScheme`, `a11yAction` |
| Wait / time | `waitFor(q \| fn)`; `clock.advance(ms)`; `clock.runAll()` (until no timers or animations are pending) |
| Inspect | `capture()` → RGBA, `scene()` → text dump, `a11yTree()`, `lastStep` / `stats()` (ops, layouts, measures, frames), `requests()` (stubbed fetches made) |
| Matchers | `toMatchImage(name, { maxDiff })`, `toHaveRole`, `toBeFocused`, `toBeVisible`; plain values use Bun's `toEqual`/`toMatchSnapshot` |

**Network:** the app runs in the test process, so `fetch` routes swap `globalThis.fetch` for the length of the test and restore it afterwards. Unmatched requests fail with a clear error unless `fetch: "live"` is given.

**Failure output:** the step that failed, the query, the texts on screen and a compact accessibility tree. With `--trace`, also every step's ops and commit timings.

**`mantou test <entry>` without a test file:** runs the app headless and replays steps from stdin. It's for quick checks and bug reports.

### 12.4 Testing Mantou, layer by layer

| Layer | Tool | What it checks |
|---|---|---|
| **Op schema and codegen** | `cargo test` + `bun test` | TS encoder → Rust decoder round trip for every op and value type. The generated code matches committed golden files. Version and ABI mismatches fail with the intended message |
| **Op decoder** | `cargo fuzz` | Malformed or truncated buffers never panic or read out of bounds; they return errors. Random *valid* op sequences keep tree invariants: one parent per child, no cycles, released ids never reused before `RELEASE` |
| **Tree and layout** | `cargo test`, property tests (`proptest`) | Incremental layout equals layout from scratch after random mutations, frame after frame. Rounding to device pixels at scales 1, 1.25, 1.5, 2 and 2.625. Known Taffy pitfalls as regression tests |
| **Text** | `cargo test` | Measure cache: a colour change means no relayout and a width change hits the cache. Bidi, wrapping, ellipsis, emoji, font fallback. Caret and selection geometry. Atlas full mid-frame → room is made and the frame repainted, with no missing glyphs |
| **Scene builder** | `cargo test` + text snapshots | Scene dumps for reference trees. Clipping, layering of scroll containers and animations, operations hidden under an opaque fill dropped |
| **Input and focus** | `cargo test` | Hit-testing with transforms and clips, tab order, pointer capture, press synthesis, wheel and momentum scrolling on the manual clock, text editing and the IME composition state machine |
| **Accessibility** | `cargo test` | AccessKit tree for reference trees: roles, names, values, states, actions, and updates after commits |
| **Renderer** | `cargo test` (offscreen wgpu) | Reference scenes drawn offscreen and compared with committed images within a per-pixel tolerance. Each backend has its own images where they legitimately differ. Once the CPU fallback exists, it becomes the oracle that GPU output is compared against |
| **TS runtime** | `bun test` with a **mock core** that records ops | Op streams per primitive and component. Granularity: one signal update → expected op count. `<If>`/`<Each>` keep siblings and moves never re-insert. Nodes are released when their owner is disposed (live-node count returns to its baseline). Event dispatch: capture and bubble, `stopPropagation`. Text-input `rev` handling |
| **JSX plugin** | `bun test` | Compile output snapshots: static vs dynamic props, spreads, refs, components, and source maps pointing back at the TSX |
| **Full stack, headless** | `bun test` + `mantou-ui/test` | Every example app and the component gallery: behaviour, accessibility queries, image snapshots, op-count budgets |

### 12.5 Window mode: the real threading model and platform layer

The same test files run with `mantou test --target window`. Each `open` starts the app as a **separate process** with a real window. The test process drives it over a local socket through a test-only automation protocol, using the same `Driver` interface as headless mode. Steps settle the same way: the app reports idle.

On top of the shared app tests, a **platform suite** covers what headless mode can't:

- **Threading (the claims the design depends on, kept as regression tests):**
  - While the Worker runs a 2-second busy loop, a scripted scroll still advances frames. Asserted by count: the frames presented during the block are at least the expected number for the display's refresh rate, minus slack.
  - A live resize while the Worker has `fetch` and timers in flight: both complete, and the window presents frames at its new size.
  - Idle: over a 5-second window with nothing changing, **0 frames presented and 0 Worker wake-ups** (counters from `mt_test_stats`, not CPU percentages).
  - The bounded resize wait never exceeds its limit; this is a counter of waits that hit the limit.
- **Platform integration:** window lifecycle and close requests, multiple windows, DPI changes (where the CI runner can simulate them), menus and their actions, clipboard round trip, file drop, dialogs (driven through the automation protocol's dialog stubs).
- **IME:** the composition path is driven by synthetic IME events in the platform layer. The real input methods (macOS Japanese/Pinyin, Microsoft IME, ibus/fcitx) are covered by a **manual release checklist**, because CI can't drive them reliably.
- **Accessibility smoke tests:** read the window through each OS's own API (AX on macOS, UI Automation on Windows, AT-SPI on Linux) from a helper process. Check that a button's role and name arrive and that a press action reaches JS.

### 12.6 CI matrix

| Job | Runner | Runs |
|---|---|---|
| `core` | Linux, macOS, Windows | `cargo test`, `cargo clippy`; fuzzing nightly (time-boxed) |
| `runtime` | Linux | `bun test` (mock core, JSX plugin, schema round trip), `tsc --noEmit` on the typings and examples |
| `headless` | Linux, macOS, Windows | `mantou test` on the examples and gallery, with image snapshots. Software GPU adapters: Mesa (lavapipe/llvmpipe) on Linux, WARP on Windows; Metal on GitHub's `macos-14` Apple Silicon runners, where wgpu's own CI runs its GPU and image tests |
| `window` | Linux (Xvfb and a headless Wayland compositor), macOS, Windows | `mantou test --target window` + the platform suite ([§12.5](/design/testing/#125-window-mode-the-real-threading-model-and-platform-layer)) |
| `package` | each OS | Build, sign (test certificates on PRs), launch the packaged app with `--self-test` (first frame drawn → exit 0), `codesign --verify` / `signtool verify` |
| `bun-canary` | Linux, macOS, Windows, nightly | All of the above against Bun's canary build, to catch `bun:ffi` and `Worker` regressions before they ship |
| `bench` | dedicated machines, main branch | [§12.7](/design/testing/#127-benchmarks-tracked-not-gating), results stored and compared |

**Image comparison (decided, T2):**
- Pixels are compared pixelmatch-style: a colour-distance threshold (default 0.1), with anti-aliased edge pixels detected and ignored. The test fails if more pixels differ than `maxDiffPixels`, which defaults to 0; tests can override both values.
- Reference images are stored per backend and OS only where the backends really differ.
- References are updated locally only, with `mantou test --update-snapshots`. CI never writes them. A failed comparison uploads the actual image, the expected one and a diff image as CI artifacts, as wgpu's CI does.
- A bot command to accept changes can come later if updating by hand becomes tedious.

### 12.7 Benchmarks (tracked, not gating)

- **Commit:** creating 1,000 rows; updating one cell in 10,000 rows (time and ops).
- **Layout:** full and incremental layout of a 5,000-node tree.
- **Text:** measuring and laying out a 1 MB document; scrolling it.
- **Scroll:** frame time of a virtual list of 1,000,000 rows during a scripted fling.
- **Start-up:** process start → first frame presented (packaged app, cold and warm).
- **Memory:** idle footprint of the counter example; growth after 10,000 open/close cycles of a dialog, which should be none.
- **Input latency:** synthetic input → frame presented, measured by the core.

Regressions above a threshold open an issue automatically. They never fail PRs, because timings are noisy.

### 12.8 Testing decisions

- **T1 Clock — decided:** use `bun:test`'s fake timers for the JS side and drive the core's clock with `mt_test_step`, both behind `app.clock` ([§12.1](/design/testing/#121-principles)). Verified in Bun 1.4.4: `jest.useFakeTimers()` moves `setTimeout`, `setInterval`, `Date.now()` and `performance.now()`, and `runAllTimers` exists. Bun has no `requestAnimationFrame`; Mantou provides its own on the core's clock.
- **T2 Image comparison — decided:** pixelmatch-style comparison that ignores anti-aliasing, with `maxDiffPixels` defaulting to 0. References are updated locally only; CI uploads actual, expected and diff images ([§12.6](/design/testing/#126-ci-matrix)).
- **T3 macOS GPU in CI — decided:** use GitHub's `macos-14` Apple Silicon runners. wgpu's own CI (`gpu-test` job) runs its GPU and image-comparison tests on them, with WARP on Windows and Mesa on Linux, the same setup as ours. A dedicated Mac is needed only for benchmarks, because timings on virtual machines are noisy.
