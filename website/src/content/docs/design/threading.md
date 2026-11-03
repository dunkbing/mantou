---
title: "Threading and architecture"
description: "Why Bun's main thread is handed to the native event loop, and how the threads and components fit together."
---

## 4. The defining constraint: who owns the main thread

- **macOS:** AppKit must run on the main thread, inside a run loop that never returns (`[NSApp run]`).
- **Linux:** GTK and Wayland/X11 integrations expect the same.
- **Windows:** windows are tied to the thread that created them.
- **Bun:** the entry script runs on the main thread. Bun has **no public API** to run one tick of its event loop, and it doesn't expose its epoll/kqueue file descriptor.

Calling the native loop from main-thread JS would freeze Bun's timers, promises and I/O. Polling the native loop from a JS timer trades idle CPU against input latency.

**Decision:** the bootstrap starts a `Worker` running the app, then calls the core's `mt_run()` on the main thread. That call blocks for the life of the process. All app JavaScript runs in the Worker.

**Validated (Linux, Bun 1.4.4):** with the main thread blocked inside an FFI call, the Worker's timers kept their schedule and its async I/O completed. A native pthread also woke the Worker through `JSCallback({ threadsafe: true })`. The spike code is in [Appendix A](/design/decisions/#appendix-a--threading-spike-validated-on-linux-bun-144).
**Not yet validated:** macOS, where Bun's main thread must also be AppKit's main thread, and Windows. Both are milestone M0 ([§13](/design/roadmap/#13-milestones)).

**M0 spike (2026-11-03), Linux:** passes with a real winit window and wgpu, under Xvfb with Mesa lavapipe; see [M0 results](/progress/m0/).
- winit's event loop runs on Bun's main thread inside `mt_run`.
- An idle window draws 0 frames and causes 0 wake-ups.
- `fetch` and timers in the Worker keep working through live resizes.
- With the Worker blocked in a busy loop for 1 s, the main thread kept drawing, and wake-ups coalesced to exactly one.

**macOS and Windows (2026-11-03):** the same self-test passes in CI ([run](https://github.com/dunkbing/mantou/actions/runs/41602279341)) on macOS (Apple Silicon, Metal) and Windows (D3D12, WARP). winit's event loop runs on Bun's main thread on all three desktops.

## 5. Architecture overview

```
┌──────────────────────────────── one process ────────────────────────────────┐
│                                                                             │
│  MAIN THREAD (native loop, no JS after bootstrap)                           │
│   winit event loop · windows · wgpu surfaces · IME · AccessKit · menus      │
│   ├─ input  ──► hit-test / scroll / focus in core ──► event queue ─► wake ──┼──┐
│   ├─ resize ──► lock tree, relayout (bounded wait) ──► repaint              │  │
│   └─ RedrawRequested ──► composite latest scene (+ native scroll/anim) ──►  │  │
│                           wgpu present                                      │  │
│                        ▲                                                    │  │
│        EventLoopProxy  │ "scene ready" / window commands                    │  │
│                        │                                                    │  │
│  WORKER THREAD (Bun Worker: the app)                                        │  │
│   TSX components ─► Solid signals ─► renderer ─► op encoder (ArrayBuffer)   │  │
│        ▲                                         │ queueMicrotask           │  │
│        │                                         ▼                          │  │
│   dispatch handlers ◄─ mt_take_events()     mt_commit(ptr,len) ─────────────┼──┤
│        ▲                                         │ (runs in core, on this   │  │
│        └──────── onWake (threadsafe JSCallback) ◄┘  thread: apply ops,      │  │
│                                                     layout, text, scene)  ◄─┼──┘
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Threads and who owns what

| Thread | Runs | Owns |
|---|---|---|
| Main | winit loop; compositing and present; IME; AccessKit adapter; menus, dialogs, clipboard | Windows, wgpu device/queue/surfaces, GPU textures and atlases, scroll offsets, running animations |
| Worker (JS) | App code; Solid; op encoding. The core's `mt_commit` runs here synchronously | JS mirror tree, signals, handlers |
| Core worker pool (optional, later) | Image decoding, font loading | — |

The **shadow tree** (nodes, styles, layout results, text layouts) sits behind a `Mutex` in the core. `mt_commit` (Worker thread) and resize relayout (main thread) both take that lock. The **scene** that drawing reads is an immutable snapshot (`Arc<Scene>`) handed from commit to the main thread, so drawing never needs the lock.

### 5.2 Invariants
1. The main thread never calls into JS, and it never waits on the tree lock longer than one commit's layout. During a resize it waits at most about 16 ms, then draws what it has.
2. JS never calls platform APIs directly. Everything goes through the core, which forwards to the main thread through winit's `EventLoopProxy`.
3. Exactly one `mt_commit` per JS turn that changed anything. Zero FFI calls for turns that changed nothing.
4. Scrolling, compositor-only animations (transform, opacity) and hover effects driven by native state need no JS round trip.
5. A node is never re-inserted where it already is. A move is an `INSERT` with a new `before` anchor.
6. The Worker reports its own failures. Once `mt_run` starts, the main thread never reads Worker messages or `error` events, so an uncaught error or rejection in the Worker logs and calls `mt_quit(70)` itself. The bootstrap waits for the Worker's `ready` message before it blocks. (Found in M0.)
