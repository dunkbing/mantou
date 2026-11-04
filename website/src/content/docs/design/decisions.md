---
title: "Alternatives, risks and decisions"
description: "Alternatives considered, risks, decisions on the former open questions, references and the threading spike appendix."
---

## 14. Alternatives considered

| Alternative | Why not (for now) |
|---|---|
| Native loop on the main thread, **pumped from a JS timer** | Idle CPU vs. input latency trade-off; Bun I/O stalls during waits |
| **Two processes** (native host + Bun process over shared memory) | More moving parts and IPC latency. **Kept as the fallback** if the Worker approach fails on some OS |
| **Layout in TS** (Yoga WASM), display list per frame | Text measurement crosses FFI mid-layout; scrolling and resize would depend on the JS thread |
| **Pure TS over `bun:ffi`** to AppKit/Win32/GTK, with no Rust | No structs by value; verbose Objective-C and COM; much more FFI traffic; three backends |
| **Wrap OS widgets** | Three implementations per widget; looks and behaves differently per platform |
| **Native views per node** (AppKit, GTK, Direct2D) | Scroll physics and text come native, but there are three backends to maintain. The core stays backend-agnostic at the scene level so this could be added later |
| **Embed a small JS engine** such as QuickJS instead of using Bun | Would run on mobile, with a small binary, but loses the JIT, npm and Node APIs. Bun can't be embedded. If mobile becomes a requirement, revisit |
| **Immediate-mode rebuild per frame** | Rebuilding the tree every frame in JS creates garbage-collection pressure; fine-grained signals avoid it |

## 15. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bun's main thread isn't usable as AppKit's main thread, or Worker + FFI is unstable on macOS or Windows | Medium | Test first, with the threading spike. Fall back to two processes |
| `bun:ffi` or Worker regressions between Bun versions | Medium | Pin the Bun version; ABI smoke tests in CI on each Bun upgrade |
| IME and text editing effort | High | Budget for it generously; start from winit's IME support; test with real CJK input methods |
| Text quality perceived as "not native" | Medium | `TextEngine` trait; screenshot comparison checkpoint once text renders; Core Text backend first if needed |
| GC timing makes the safety-net release unpredictable | Low | Deterministic release on owner disposal ([§7.4](/design/runtime/#74-node-lifetime)) |
| Binary size (~109 MB for a compiled Bun app) and memory vs. Go or Rust frameworks | Certain | Document it; it's the price of Bun's ecosystem |

## 16. Decisions (formerly open questions)

1. **Name: Mantou.** The npm name `mantou` belongs to an unrelated project, so the package is `mantou-ui`.
2. **Text input:** controlled (`value` + `onChange`, reconciled by `rev`) and uncontrolled (`defaultValue`), with editing owned by the core in both, and declarative constraints instead of synchronous filters ([§8.3](/design/protocols/#83-text-input)).
3. **Node release:** deterministic release when the owning Solid scope is disposed, with a `FinalizationRegistry` safety net ([§7.4](/design/runtime/#74-node-lifetime)).
4. **Styling:** typed style objects, with shared `STYLE_DEF`/`STYLE_USE` on the wire ([§8.4](/design/protocols/#84-styles)). A build-time class subset could compile into the same definitions later.
5. **Text engine:** parley everywhere behind a `TextEngine` trait, so text is the same on every OS ([§8.5](/design/protocols/#85-text)).
6. **Native core: build our own.** Existing candidates were large, carried their own reactive graph, and targeted native views rather than a GPU scene.
7. **Hot reload:** `mantou dev` restarts the Worker on save and keeps the windows open ([#25](https://github.com/dunkbing/mantou/issues/25)). State survives only if the app opts in; component-level HMR is deferred.

## 17. References

- **Solid** `solid-js/universal`, `babel-preset-solid` (`generate: "universal"`).
- **Rust crates:** winit, wgpu, taffy, parley, fontique, swash, accesskit, muda, rfd, arboard.

---

## Appendix A — Threading spike (validated on Linux, Bun 1.4.4)

Validated on Linux with Bun 1.4.4: while the main thread was blocked in native code for 2 s (as `[NSApp run]` would), a Worker's 100 ms timer kept time, file reads completed, and a native thread's callbacks into JS ran on schedule. The test results are in [Status: threading](/progress/threading/).
