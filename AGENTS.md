# AGENTS.md

Guide for coding agents (and people) working on Mantou: a native GUI framework for Bun + TypeScript. The app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on Bun's main thread and draws with wgpu.

**Docs:** `website/src/content/docs/` (rendered: `bun run docs`; for LLMs: `/llms.txt`, `/llms-full.txt`, and any page as Markdown at `/<page>.md`). Read `design/threading.md` and `design/protocols.md` before changing the core or the protocol. Code comments cite the design as "design §N"; the section numbers are the pages' headings.

## Layout

| Path | What |
|---|---|
| `schema/protocol.ts` | **Source of truth** for ops, node kinds, style properties and events |
| `schema/gen.ts` | Generates `runtime/gen/protocol.ts`, `core/crates/mantou-tree/src/protocol.rs`, `schema/fixtures/*` |
| `runtime/index.ts` | `mantou-ui`, what apps import: `run`, `mount`, `View`, `Text`, `Input`, `For`/`Index`/`Show`, `defineStyle`, Solid's reactivity |
| `runtime/solid/` | The JSX layer: `plugin.ts` (Bun plugin: Babel + `babel-preset-solid`, universal mode), `renderer.ts` (Solid's universal renderer over the node tree), `components.ts`, `mount.ts`, `solid.ts` (Solid's client build), `preload.ts` |
| `runtime/` | The rest: `main.ts` (bootstrap, main thread), `worker.ts` (Worker entry: registers the plugin, imports the app), `run.ts`, `core.ts` (window client), `headless.ts` (headless instances for tests), `ui.ts` (node tree, one commit per turn), `encoder.ts`/`decode.ts`/`style.ts`/`events.ts` (wire format), `mock.ts` (mock core), `jsx-runtime.ts` (JSX types), `ffi.ts` (bindings) |
| `core/crates/mantou-tree` | Shadow tree: op decoding and encoding, styles, Taffy layout, scene, hit-testing, `Tree::check`; inputs' focus, keys, pointer and IME (`src/tree/input.rs`). No platform deps |
| `core/crates/mantou-text` | Text: parley layout, swash rasterization, the glyph atlas, the bundled Inter font (`fonts/`, OFL); the inputs' editor (`editor.rs`: caret, selection, undo, limits, scrolling) |
| `core/crates/mantou-render` | wgpu renderer: one instanced pipeline for rectangles (SDF rounded corners, borders) and glyphs, with clip rects; to a window surface or offscreen |
| `core/crates/mantou-ffi` | The C ABI (`mt_*`): instances (`instance.rs`: events, the clipboard), the winit window (`window.rs`: keys, IME), headless test hooks |
| `core/fuzz` | cargo-fuzz targets (`decode`, `apply`, `layout`); nightly only, its own workspace |
| `examples/counter` | `Counter.tsx`, a Solid component; `main.tsx` runs it; `Counter.test.tsx` tests it on the mock core |
| `examples/todos` | A to-do list with `<Input>`s; `Todos.test.tsx` tests it headless |
| `tests/` | Bun tests against the real core, headless (`headless.test.tsx`) |
| `spike/` | `selftest.ts` (window self-test), `app.ts` (threading demo) |
| `scripts/` | `npm.ts` (stages the npm packages of a release), `smoke.ts` (installs them into a fresh app and tests it) |
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
bun run todos               # the to-do list (text input) in a window
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
12. **The core owns text editing.** An `<Input>`'s caret, selection, undo, clipboard and IME live in the core, so typing never waits for JS; JS hears `TEXT_CHANGED` with a `rev`, and a `VALUE` with an older `rev` than the user's latest edit is ignored. Keys the focused input uses never reach `onKey`. Typing in an uncontrolled input sends no ops, and neither does a controlled input's echo.
13. **Layout is CSS flexbox.** `flexShrink` defaults to 1 and flex items are at least as tall as their content unless they clip, so fixed-size parts need `flexShrink: 0` and scroll containers' ancestors need `minHeight: 0`. Use `node.measure()` for sizes the app needs (it commits first, then asks the core).

## Apps built on Mantou

Apps live in their own repos and depend on `mantou-ui` from npm (`bun add mantou-ui`, with a prebuilt core per platform as an optional dependency: `mantou-ui-linux-x64`, `-linux-arm64`, `-darwin-arm64`, `-darwin-x64`, `-windows-x64`) or from GitHub (`bun add github:dunkbing/mantou`, then `mantou build-core`), as [dunkbing/mantou-mail](https://github.com/dunkbing/mantou-mail) does. They use the package's exports (`mantou-ui`, `mantou-ui/headless`, `mantou-ui/mock`, `mantou-ui/preload`) and the `mantou` command (`runtime/cli.ts`: `build-core`, `run`), so keep those working: a change to them is a breaking change for every app.

Apps report what they need as issues here, through the templates in `.github/ISSUE_TEMPLATE` (bug reports with a minimal repro, ideally a failing headless test; feature requests with the app feature they unblock and an API sketch). When fixing one, turn its repro into a test in this repo, and say in the issue which commit has the fix so the app can update (`bun update mantou-ui`).

## Releases

Push a tag `vX.Y.Z` (or run the `release` workflow, a dry run by default): it builds the core on each platform, stages and packs the packages, smoke-tests them from the tarballs on Linux (x64, arm64), macOS and Windows, publishes the platform packages and then `mantou-ui` with provenance (secret `NPM_TOKEN`), and tests the published version from npm. `package.json`'s version stays `0.0.0`; the tag sets it. A prebuilt core is found through `runtime/ffi.ts`'s `libPath()`: `MANTOU_CORE`, then a core built in `core/target`, then the platform package.

## Before you finish

Run `bun run gen:check && bun run typecheck && bun run test && bun run test:core && bun run test:headless`. If you touched the window path, also run the self-test. If behaviour or the protocol changed, update the matching page in `website/src/content/docs/` (`progress/` holds test results).
