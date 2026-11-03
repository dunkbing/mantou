---
title: Threading model
description: Test results for Mantou's threading model — Bun's main thread runs the native event loop while the app runs in a Worker — on Linux, macOS and Windows.
---

## What's being tested

The design depends on one claim ([design §4](/design/threading/#4-the-defining-constraint-who-owns-the-main-thread)). Bun's main thread can be handed to the native event loop for the life of the process, while all app JavaScript runs in a Worker, and Bun's timers and I/O keep working. The window self-test (`spike/selftest.ts`, `bun run selftest`) checks that with a real window:

```
main thread   bun runtime/main.ts → new Worker(app) → wait for "ready" → mt_run()  (winit loop, wgpu, never returns to JS)
Worker        app code → ops → mt_commit()        core events → threadsafe JSCallback wake → mt_take_events()
```

| File | What it is |
|---|---|
| `runtime/main.ts` | Bootstrap on Bun's main thread |
| `runtime/core.ts` | Worker-side client: one commit per JS turn, event decoding, crash reporting |
| `core/crates/mantou-ffi` | The C ABI, the winit event loop, the event queue with coalesced wake-ups, test hooks |
| `spike/selftest.ts` | The window self-test; writes `selftest-report.json` |
| `spike/app.ts` | Interactive demo: click to change colour, keys show in the title, Escape quits |
| `.github/workflows/ci.yml` | Runs the self-test on Linux, macOS and Windows |

## Results

**Linux x64, Bun 1.4.4, Xvfb, Mesa llvmpipe (software Vulkan), 4 vCPUs:** every check passes, in every run so far. A report from the first runs is [here](/reports/threading-linux.json).

| Check | Result |
|---|---|
| Window + first frame on the main thread | ✅ about 110 ms from launch to first frame (warm), 720 ms cold |
| Commit from the Worker → frame | ✅ 1 commit → 1 frame, about 5 ms |
| Idle for 3 s | ✅ **0 frames, 0 wake-ups, 0 commits, 0.15% of one core** |
| Live resize (20×) while the Worker runs `fetch` in a loop and a 10 ms timer | ✅ 20 resizes → 20 frames → 20 events in JS; about 7,500 fetches, 0 failures; 119 of 120 timer ticks |
| Worker blocked for 1 s (busy loop) | ✅ main thread drew 12 frames meanwhile; **exactly 1 wake-up** (coalesced); all 12 events delivered afterwards |

**Real X11 input** (driven with xdotool's XTEST): clicks change the colour, a key press shows in the title, and Escape quits with exit code 0.

![Window before a click, after one click, after three clicks](../../../assets/clicks.png)

**macOS and Windows:** the self-test passes in CI ([run](https://github.com/dunkbing/mantou/actions/runs/41602279341)) on GitHub's `macos-14` (Apple Silicon, Metal) and `windows-2022` (D3D12, WARP) runners. Each run uploads its `selftest-report-*` artifacts.

## Findings

- **The main thread must never be the only one that knows about an error.** Once `mt_run` starts, the main thread runs no JavaScript, so it never reads Worker messages or `error` events. The Worker reports its own uncaught errors and quits (`runtime/core.ts`). The bootstrap waits for a `ready` message before blocking.
- **Linux runtime dependencies:** winit loads `libxkbcommon-x11` at run time, and a missing library panics at start-up. The panic is caught at the C boundary and reported as exit code 101 with a clear message, but packages (`.deb`, AppImage) must declare these libraries.
- **Synthetic X events are ignored:** winit ignores `XSendEvent` key events, so test input must use XTEST or the core's own input hook ([§12.2](/design/testing/#122-headless-mode-core-support)).
- **wgpu 30** takes the display handle at instance creation, and OpenGL (EGL) needs it. The self-test also passes on the GL backend (`WGPU_BACKEND=gl`).
- **Memory:** about 150 MB RSS in the self-test, almost all of it Mesa's software rasterizer, which carries an LLVM JIT. Bun plus an idle Worker measured 24 MB. MyGo reports the same effect from Mesa.
- **Size:** the core library is 7.9 MB stripped on Linux; the unstripped build with line tables is 59 MB.
