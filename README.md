# Mantou

A native GUI framework for Bun + TypeScript: a Rust core loaded with `bun:ffi` draws the UI with wgpu, and the app runs in a Bun Worker. See [DESIGN.md](DESIGN.md).

**Status: M0 spike.** It proves the threading model; there's no UI toolkit yet.

## What M0 proves

The design depends on one claim (DESIGN.md §4). Bun's main thread can be handed to the native event loop for the life of the process, while all app JavaScript runs in a Worker, and Bun's timers and I/O keep working. M0 tests that with a real window:

```
main thread   bun runtime/main.ts → new Worker(app) → wait for "ready" → mt_run()  (winit loop, wgpu, never returns to JS)
Worker        app code → ops → mt_commit()        core events → threadsafe JSCallback wake → mt_take_events()
```

| File | What it is |
|---|---|
| `core/crates/mantou-ffi/src/lib.rs` | Native core: C ABI, winit event loop, wgpu clear-colour renderer, event queue with coalesced wake-ups, stats, test hooks |
| `runtime/ffi.ts` | `bun:ffi` bindings and ABI version check |
| `runtime/main.ts` | Bootstrap on Bun's main thread |
| `runtime/core.ts` | Worker-side client: op encoder (one commit per JS turn), event decoding, crash reporting |
| `spike/app.ts` | Interactive demo: click to change colour, keys show in the title, Escape quits |
| `spike/selftest.ts` | Automated check of the M0 exit criteria; writes `m0-report.json` |
| `.github/workflows/m0.yml` | Runs the self-test on Linux, macOS and Windows |

## Run it

Requirements:
- **Bun:** 1.4.4 (pinned).
- **Rust:** stable.
- **Linux:** a Vulkan or GL driver; Mesa's lavapipe works without a GPU. Also winit's X11 libraries (`libxkbcommon-x11-0`, `libxcursor1`, `libxi6`, `libxrandr2`).

```bash
bun install
```

```bash
bun run build:core
```

```bash
bun run app
```

```bash
bun run selftest
```

On a headless Linux machine, run the self-test under Xvfb:

```bash
xvfb-run -a -s "-screen 0 1280x800x24" bun run selftest
```

## Results

**Linux x64, Bun 1.4.4, Xvfb, Mesa llvmpipe (software Vulkan), 4 vCPUs:** 5/5 checks pass. Seven consecutive runs all passed. The report is in [`docs/m0/report-linux.json`](docs/m0/report-linux.json).

| Check | Result |
|---|---|
| Window + first frame on the main thread | ✅ about 110 ms from launch to first frame (warm), 720 ms cold |
| Commit from the Worker → frame | ✅ 1 commit → 1 frame, about 5 ms |
| Idle for 3 s | ✅ **0 frames, 0 wake-ups, 0 commits, 0.15% of one core** |
| Live resize (20×) while the Worker runs `fetch` in a loop and a 10 ms timer | ✅ 20 resizes → 20 frames → 20 events in JS; about 7,500 fetches, 0 failures; 119 of 120 timer ticks |
| Worker blocked for 1 s (busy loop) | ✅ main thread drew 12 frames meanwhile; **exactly 1 wake-up** (coalesced); all 12 events delivered afterwards |

**Real X11 input** (driven with xdotool's XTEST): clicks change the colour, a key press shows in the title, and Escape quits with exit code 0.

![Window before a click, after one click, after three clicks](docs/m0/clicks.png)

**Not yet verified:** macOS and Windows. The CI workflow covers both, but it hasn't run because the project isn't in a repository yet.

## Findings so far

- **The main thread must never be the only one that knows about an error.** Once `mt_run` starts, the main thread runs no JavaScript, so it never reads Worker messages or `error` events. The Worker reports its own uncaught errors and quits (`runtime/core.ts`). The bootstrap waits for a `ready` message before blocking.
- **Linux runtime dependencies:** winit loads `libxkbcommon-x11` at run time, and a missing library panics at start-up. The panic was caught at the C boundary and reported as exit code 101 with a clear message, but packages (`.deb`, AppImage) must declare these libraries.
- **Synthetic X events are ignored:** winit ignores `XSendEvent` key events, so test input must use XTEST or the core's own input-injection hook (DESIGN.md §12.2).
- **wgpu 30** takes the display handle at instance creation, and OpenGL (EGL) needs it. The same self-test also passes on the GL backend (`WGPU_BACKEND=gl`).
- **Memory:** 146 MB RSS in the self-test, almost all of it Mesa's software rasterizer, which carries an LLVM JIT. Bun plus an idle Worker measured 24 MB. MyGo reports the same effect from Mesa. Real-GPU numbers will come from the macOS and Windows CI runs.
- **Size:** the core library is 7.9 MB stripped on Linux; the unstripped build with line tables is 59 MB.
