# AGENTS.md

Guide for coding agents (and people) working on Mantou: a native GUI framework for Bun + TypeScript. The app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on Bun's main thread and draws with wgpu.

**Docs:** `website/src/content/docs/` (rendered: `bun run docs`; for LLMs: `/llms.txt`, `/llms-full.txt`, and any page as Markdown at `/<page>.md`). Read `design/threading.md` and `design/protocols.md` before changing the core or the protocol.

## Layout

| Path | What |
|---|---|
| `schema/protocol.ts` | **Source of truth** for ops, node kinds, style properties and events |
| `schema/gen.ts` | Generates `runtime/gen/protocol.ts`, `core/crates/mantou-tree/src/protocol.rs`, `schema/fixtures/*` |
| `runtime/` | TypeScript runtime: `main.ts` (bootstrap, main thread), `core.ts` (Worker client over FFI), `ui.ts` (node tree, one commit per turn), `encoder.ts`/`decode.ts`/`style.ts` (wire format), `mock.ts` (mock core for tests), `ffi.ts` (bindings) |
| `core/crates/mantou-tree` | Shadow tree: op decoding, styles, Taffy layout, scene, hit-testing. No platform deps |
| `core/crates/mantou-render` | wgpu renderer (instanced quads) |
| `core/crates/mantou-ffi` | The C ABI (`mt_*`), winit event loop, event queue |
| `examples/counter` | The M1 example; `counter.ts` takes a `Ui`, so it runs in a window and against the mock |
| `spike/` | `selftest.ts` (window self-test of the M0/M1 exit criteria), `app.ts` (M0 demo) |
| `website/` | Docs site (Astro + Starlight on Bun) |

## Commands

```bash
bun install                 # deps (root); `cd website && bun install` for the site
bun run build:core          # cargo build --release (needed before anything that opens a window)
bun run gen                 # regenerate protocol bindings + fixtures after editing schema/protocol.ts
bun run gen:check           # CI: fails if generated files are stale
bun run typecheck           # tsc
bun run test                # bun tests (runtime, examples)
bun run test:core           # cargo tests (mantou-tree, incl. the TS→Rust fixture)
bun run selftest            # window self-test; on headless Linux: xvfb-run -a bun run selftest
bun run counter             # the counter example in a window
cd website && bun run build # docs site (Astro runs on Bun via `bunx --bun`)
```

Linux needs a Vulkan or GL driver (Mesa lavapipe works without a GPU) and `libxkbcommon-x11-0 libxcursor1 libxi6 libxrandr2`.

## Rules

1. **The main thread never runs app JS and never waits on it.** After `mt_run` starts, the bootstrap's thread is inside the native loop. The Worker reports its own errors (`runtime/core.ts`) and quits; nothing on the main thread would notice.
2. **One commit per JS turn.** `Ui.schedule()` flushes in a microtask; never call `mt_commit` per node or per property.
3. **The protocol changes only in `schema/protocol.ts`.** Never edit generated files; never renumber or reuse a code; append. Run `bun run gen` and commit the generated files and fixtures. Bump `PROTOCOL_VERSION` when meaning changes, and `ABI_VERSION` (`mantou-ffi` and `runtime/ffi.ts`, together) when an exported signature or the event format changes.
4. **A node already in place is never re-inserted** (`Node.insertBefore` and `Tree::insert` both skip it).
5. **C ABI functions take scalars, pointers and lengths only** (no structs by value), and catch panics (`guard`).
6. **Tests wait for conditions, not time, and assert counts, not durations.** Op counts per interaction are part of the tests (e.g. pressing + in the counter is exactly 4 ops).
7. **`mantou-tree` stays platform-free** so it can be tested headless.

## Before you finish

Run `bun run gen:check && bun run typecheck && bun run test && bun run test:core`. If you touched the core or the runtime's FFI path, also run the self-test. If behaviour or the protocol changed, update the matching page in `website/src/content/docs/` (and `progress/` for milestone results).
