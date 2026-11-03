# AGENTS.md

Guide for coding agents (and people) working on Mantou: a native GUI framework for Bun + TypeScript. The app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on Bun's main thread and draws with wgpu.

**Docs:** `website/src/content/docs/` (rendered: `bun run docs`; for LLMs: `/llms.txt`, `/llms-full.txt`, and any page as Markdown at `/<page>.md`). Read `design/threading.md` and `design/protocols.md` before changing the core or the protocol. Code comments cite the design as "design §N"; the section numbers are the pages' headings.

## Layout

| Path | What |
|---|---|
| `schema/protocol.ts` | **Source of truth** for ops, node kinds, style properties and events |
| `schema/gen.ts` | Generates `runtime/gen/protocol.ts`, `core/crates/mantou-tree/src/protocol.rs`, `schema/fixtures/*` |
| `runtime/index.ts` | `mantou-ui`, what apps import: `run`, `mount`, `View`, `For`/`Index`/`Show`, `defineStyle`, Solid's reactivity |
| `runtime/solid/` | The JSX layer: `plugin.ts` (Bun plugin: Babel + `babel-preset-solid`, universal mode), `renderer.ts` (Solid's universal renderer over the node tree), `components.ts`, `mount.ts`, `solid.ts` (Solid's client build), `preload.ts` |
| `runtime/` | The rest: `main.ts` (bootstrap, main thread), `worker.ts` (Worker entry: registers the plugin, imports the app), `run.ts`, `core.ts` (window client), `headless.ts` (headless instances for tests), `ui.ts` (node tree, one commit per turn), `encoder.ts`/`decode.ts`/`style.ts`/`events.ts` (wire format), `mock.ts` (mock core), `jsx-runtime.ts` (JSX types), `ffi.ts` (bindings) |
| `core/crates/mantou-tree` | Shadow tree: op decoding and encoding, styles, Taffy layout, scene, hit-testing, `Tree::check`. No platform deps |
| `core/crates/mantou-text` | Text: parley layout, swash rasterization, the glyph atlas, the bundled Inter font (`fonts/`, OFL) |
| `core/crates/mantou-render` | wgpu renderer: one instanced pipeline for rectangles (SDF rounded corners, borders) and glyphs, with clip rects; to a window surface or offscreen |
| `core/crates/mantou-ffi` | The C ABI (`mt_*`): instances (`instance.rs`), the winit window (`window.rs`), headless test hooks |
| `core/fuzz` | cargo-fuzz targets (`decode`, `apply`, `layout`); nightly only, its own workspace |
| `examples/counter` | `Counter.tsx`, a Solid component; `main.tsx` runs it; `Counter.test.tsx` tests it on the mock core |
| `examples/mail` | Mantou Mail: `data.ts` (sample mail), `state.ts` (signals and actions), `App.tsx` (UI, keys), `Mail.test.tsx` (headless) |
| `tests/` | Bun tests against the real core, headless (`headless.test.tsx`) |
| `spike/` | `selftest.ts` (window self-test), `app.ts` (threading demo) |
| `website/` | Docs site (Astro + Starlight on Bun); deployed separately, not built in CI |

## Commands

```bash
bun install                 # deps (root); `cd website && bun install` for the site
bun run build:core          # cargo build --release (needed before headless tests or a window)
bun run gen                 # regenerate protocol bindings + fixtures after editing schema/protocol.ts
bun run gen:check           # fails if generated files are stale
bun run typecheck           # bun check
bun run test                # Bun tests of the runtime and examples (mock core)
bun run test:headless       # Bun tests on the real core, no window (captures need a GPU adapter; lavapipe is fine)
bun run test:core           # cargo tests: tree, fixtures, random batches, incremental-vs-scratch layout
bun run selftest            # window self-test; on headless Linux: xvfb-run -a bun run selftest
bun run counter             # the counter in a window (bun runtime/main.ts <entry.tsx> runs any app)
bun run mail                # Mantou Mail in a window
cd core/fuzz && LSAN_OPTIONS=suppressions=$PWD/lsan.supp cargo +nightly fuzz run layout -- -max_total_time=60   # or decode, apply
cd website && bun run build # docs site (Astro runs on Bun via `bunx --bun`)
```

Linux needs a Vulkan or GL driver (Mesa lavapipe works without a GPU) and `libxkbcommon-x11-0 libxcursor1 libxi6 libxrandr2` for windows.

## Rules

1. **The main thread never runs app JS and never waits on it.** After `mt_run` starts, the bootstrap's thread is inside the native loop. The Worker reports its own errors (`runtime/core.ts`) and quits; nothing on the main thread would notice.
2. **One commit per JS turn.** `Ui.schedule()` flushes in a microtask; never call `mt_commit` per node or per property.
3. **The protocol changes only in `schema/protocol.ts`.** Never edit generated files; never renumber or reuse a code; append. Run `bun run gen` and commit the generated files and fixtures. Bump `PROTOCOL_VERSION` when meaning changes, and `ABI_VERSION` (`mantou-ffi` and `runtime/ffi.ts`, together) when an exported signature or the event format changes.
4. **A node already in place is never re-inserted** (`Node.insertBefore` and `Tree::insert` both skip it).
5. **C ABI functions take scalars, pointers and lengths only** (no structs by value), take an instance handle when they act on a UI, and catch panics (`guard`).
6. **Validate before allocating.** Counts and lengths from a batch are checked against its size first (the fuzzer found an abort from exactly this).
7. **Tests wait for conditions, not time, and assert counts, not durations.** Op counts per interaction are part of the tests (pressing + in the counter is exactly 4 ops).
8. **`mantou-tree` stays platform-free**, and incremental layout must equal layout from scratch (`tests/layout.rs`, fuzz target `layout`).
9. **JSX goes through Mantou's plugin, and Solid's API comes from `mantou-ui`.** Bun resolves a bare `solid-js` to Solid's server build (no reactivity) and its runtime plugins can't redirect bare imports, so `.ts` files must never import `solid-js` directly; the plugin rewrites it in `.tsx` files. Apps run through `runtime/main.ts` (the Worker entry registers the plugin); tests get it from `bunfig.toml`'s preload.
10. **A Solid owner's nodes are released when it's disposed** (`createElement` registers the cleanup); never release a node a component still owns.
11. **Text goes inside `<Text>`**, which holds only text (its content is its text leaves joined, sent as one `TEXT` op per change). Text elsewhere isn't drawn, and the runtime warns once.
12. **Layout is CSS flexbox.** `flexShrink` defaults to 1 and flex items are at least as tall as their content unless they clip, so fixed-size parts need `flexShrink: 0` and scroll containers' ancestors need `minHeight: 0`. Use `node.measure()` for sizes the app needs (it commits first, then asks the core).

## Before you finish

Run `bun run gen:check && bun run typecheck && bun run test && bun run test:core && bun run test:headless`. If you touched the window path, also run the self-test. If behaviour or the protocol changed, update the matching page in `website/src/content/docs/` (`progress/` holds test results).
