---
title: "Alternatives, risks and decisions"
description: "Alternatives considered, risks, decisions on the former open questions, references and the threading spike appendix."
---

## 15. Alternatives considered

| Alternative | Why not (for now) |
|---|---|
| Native loop on the main thread, **pumped from a JS timer** | Idle CPU vs. input latency trade-off; Bun I/O stalls during waits |
| **Two processes** (native host + Bun process over shared memory) | More moving parts and IPC latency. **Kept as the fallback** if the Worker approach fails M0 on some OS |
| **Layout in TS** (Yoga WASM), display list per frame | Text measurement crosses FFI mid-layout; scrolling and resize would depend on the JS thread |
| **Pure TS over `bun:ffi`** to AppKit/Win32/GTK, with no Rust | No structs by value; verbose Objective-C and COM; much more FFI traffic; three backends |
| **Wrap OS widgets** | Three implementations per widget; looks and behaves differently per platform |
| **Native views per node** (NSH's approach) | Scroll physics and text come native, but there are three backends to maintain. The core stays backend-agnostic at the scene level so this could be added later |
| **Embed QuickJS** instead of using Bun (NSH's approach) | Would run on mobile, with a small binary, but loses the JIT, npm and Node APIs. Bun can't be embedded. If mobile becomes a requirement, revisit, or use NSH itself |
| **Immediate-mode rebuild per frame** (MyGo's approach) | Rebuilding the tree every frame in JS creates garbage-collection pressure; fine-grained signals avoid it |

## 16. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bun's main thread isn't usable as AppKit's main thread, or Worker + FFI is unstable on macOS or Windows | Medium | Test first in M0. Fall back to two processes |
| `bun:ffi` or Worker regressions between Bun versions | Medium | Pin the Bun version; ABI smoke tests in CI on each Bun upgrade |
| IME and text editing effort | High | Budget M5 generously; start from winit's IME support; test with real CJK input methods |
| Text quality perceived as "not native" | Medium | `TextEngine` trait; screenshot comparison checkpoint after M3; Core Text backend first if needed |
| GC timing makes the safety-net release unpredictable | Low | Deterministic release on owner disposal ([§7.4](/design/runtime/#74-node-lifetime)) |
| Binary size (~109 MB for a compiled Bun app) and memory vs. Go or Rust frameworks | Certain | Document it; it's the price of Bun's ecosystem |

## 17. Decisions (formerly open questions)

1. **Q1 Name — resolved: Mantou.** The npm name `mantou` is held by an unrelated Bun project template (`bun create mantou-app`; last published 2025-02, ~135 downloads/month in Oct 2026). Use `mantou-ui` (free on npm and crates.io as of 2026-11-03), or ask the owner to transfer `mantou`. Still to check: a `@mantou` npm scope, the GitHub org, the domain, and trademarks.
2. **Q2 Text input — decided:** controlled (`value` + `onChange`, reconciled by `rev`) and uncontrolled (`defaultValue`) modes, with editing owned by the core in both, and declarative constraints instead of synchronous filters ([§8.3](/design/protocols/#83-text-input)). This matches what React and DOM developers expect without making typing wait for JS.
3. **Q3 Node release — decided:** deterministic release when the owning Solid scope is disposed, a `FinalizationRegistry` safety net, and a development-build warning when the safety net fires ([§7.4](/design/runtime/#74-node-lifetime)). Native resources such as textures and text layouts shouldn't wait on JavaScriptCore's GC timing.
4. **Q4 Styling — decided:** typed style objects in v1, with shared `STYLE_DEF`/`STYLE_USE` on the wire from M1, and an optional build-time Tailwind subset after M6 that compiles into the same definitions ([§8.4](/design/protocols/#84-styles)). Type checking and a small surface come first; classes later cost no change to the core.
5. **Q5 Text engine — decided:** parley everywhere behind a `TextEngine` trait, with a screenshot comparison against native labels after M3 and Core Text as the first native backend if needed ([§8.5](/design/protocols/#85-text)). One engine means one code path and text snapshots that hold on every OS.
6. **Q6 Reuse `nsh-core` — decided: no; borrow ideas, not the crate.** Checked at NSH @b13c8c2: `nsh-core` is about 149k lines of Rust.
   - It carries NSH's own reactive graph (we keep Solid in JS), a Tailwind parser, navigation, storage, WebSocket and tokio.
   - Its output is `MountItem`s for native views (`Create { kind: ViewKind }`, `Insert`…) rather than a scene for a GPU renderer.
   - It's at version 0.3, so its API is still moving.
   - Adopting it would mean adopting NSH's architecture. What we take instead, under Apache-2.0 with attribution where code is copied: Taffy's rounding fix, the measure-cache design, the `before`-anchored insert, and the pitfall list as regression tests.
7. **Q7 Hot reload — decided:** `mantou dev` restarts the Worker on save and keeps the windows open. The core clears the instance's tree but keeps windows, surfaces, GPU resources and atlases, so nothing flashes, and the new Worker rebuilds the UI.
   - State survives only if the app opts in, through `persist(key, signal)`, which stashes values in the core across restarts (development builds only).
   - Component-level hot module replacement (solid-refresh style) is deferred. A fresh Worker never leaves stale module state behind, and Bun starts a Worker in milliseconds.

## 18. References

- **MyGo**, `docs/architecture.md` §"Native UI" (line 2234 on): frame loop `ui/runtime.go` (`runFrame`); layout cache `ui/layoutcache.go`; paint `ui/paint.go`; scene `internal/scene/scene.go`; GPU renderers `internal/gpu/{metal,d3d11,gl}`; present and fallback `ui/window.go` (`present`).
- **NSH**, `docs/dev/architecture.md` (thread model, commit pipeline); `docs/dev/native-pipeline.md` (JSX compiler, renderer, ops, lists); `docs/dev/pitfalls.md` (Taffy rounding, re-insert, GC roots); `docs/dev/macos.md` (bounded resize wait).
- **Solid** `solid-js/universal`, `babel-preset-solid` (`generate: "universal"`).
- **Rust crates:** winit, wgpu, taffy, parley, fontique, swash, accesskit, muda, rfd, arboard.

---

## Appendix A — Threading spike (validated on Linux, Bun 1.4.4)

```c
// native.c — a native thread that calls back into JS three times
#include <pthread.h>
#include <unistd.h>
typedef void (*cb_t)(int);
static cb_t cb;
static void *run(void *a) { for (int i = 1; i <= 3; i++) { usleep(300000); cb(i); } return 0; }
void start(cb_t f) { cb = f; pthread_t t; pthread_create(&t, 0, run, 0); pthread_detach(t); }
```

```ts
// main.ts — the main thread blocks in native code, as [NSApp run] would
import { dlopen, FFIType } from "bun:ffi";
const libc = dlopen("libc.so.6", { sleep: { args: [FFIType.u32], returns: FFIType.u32 } });
new Worker(new URL("./worker.ts", import.meta.url).href);
await Bun.sleep(50);
libc.symbols.sleep(2);
```

```ts
// worker.ts — timers, async I/O and native wake-ups keep working
import { dlopen, JSCallback, FFIType } from "bun:ffi";
const lib = dlopen(import.meta.dir + "/libnative.so", { start: { args: [FFIType.function], returns: FFIType.void } });
const cb = new JSCallback((n: number) => console.log("native event", n),
  { args: ["i32"], returns: "void", threadsafe: true });
lib.symbols.start(cb.ptr);
setInterval(() => console.log("tick"), 100);
console.log((await Bun.file(import.meta.path).text()).length);
```

Observed while the main thread was blocked for 2 s: the 100 ms timer kept time, the file read completed, and the native thread's three callbacks ran at 300 ms intervals.
