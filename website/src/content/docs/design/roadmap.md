---
title: "Milestones and packaging"
description: "The milestone plan from M0 to M8 and how apps are packaged and distributed."
---

## 13. Milestones

| | Deliverable | Exit criteria |
|---|---|---|
| **M0** Threading spike | Bootstrap + Worker + winit window + wgpu clear colour + events round trip | Works on macOS, Windows and Linux. `fetch` and timers in the Worker keep working during live resize. Idle CPU ≈ 0% — **✅ Linux, macOS, Windows (2026-11-03)** |
| **M1** Tree and ops | Op encoder and decoder from a shared schema; shadow tree; Taffy; rects drawn | Counter example updates through ops; one FFI call per turn; headless instance + mock core in CI ([§12.8](/design/testing/#128-test-infrastructure-per-milestone)) — **in progress: see [M1 progress](/progress/m1/)** |
| **M2** Renderer | Rounded rects, borders, shadows, clips, images, HiDPI | Renderer reference-image tests pass on all three backends |
| **M3** Text | parley layout, atlases, spans, measure cache | Wrapping, bidi and emoji render; colour change triggers no relayout |
| **M4** Interaction | Hit-testing, press, focus, keyboard, native scrolling, Solid renderer + JSX plugin | Scrolling stays at the display's refresh rate while the Worker runs `while(true)` |
| **M5** Inputs | Text input with IME, selection, clipboard | CJK IME works on all three OSes |
| **M6** Components | Unstyled base components, virtual list, transitions | Gallery example |
| **M7** Platform and accessibility | Menus, dialogs, multiple windows, AccessKit | Basic VoiceOver and Narrator walkthroughs work |
| **M8** Ship | CLI `dev` (hot reload by restarting the Worker, keeping the windows; [§17](/design/decisions/#17-decisions-formerly-open-questions) Q7), `build`, `package`; signing and notarization | Signed `.app`/`.dmg`, installer and AppImage from CI; an edit shows in under 300 ms in the counter example |

## 14. Packaging and distribution

- `bun build --compile ./main.ts ./app-worker.ts` produces a single executable containing both the bootstrap and the Worker entry. Verified with Bun 1.4.4 on Linux: the Worker entry must be listed as an extra entry point, and `bun:ffi` works inside the compiled Worker.
- The native core: `dlopen` needs a real file. Ship it beside the binary inside the bundle, or embed it and extract it to a cache directory named by a content hash on first run.
- **macOS:**
  - `.app` bundle, plus a `.dmg`.
  - Code signing with the hardened runtime. JavaScriptCore's JIT requires the `com.apple.security.cs.allow-jit` entitlement.
  - Notarization.
- **Windows:** an installer (MSI or NSIS), signed with Authenticode.
- **Linux:** AppImage and `.deb`. Runtime dependencies are few: Vulkan or GL drivers, and the libraries winit needs (Wayland/X11, xkbcommon).
- **Size:** dominated by the Bun runtime. A minimal compiled bootstrap + Worker measured about 109 MB (104 MiB) on Linux x64 with Bun 1.4.4, before the native core. Track it from M0 onwards, and check whether compression in the installers (DMG, MSI or NSIS, AppImage) brings the download down substantially.
