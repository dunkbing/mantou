---
title: "Overview"
description: "What Mantou is, its goals and non-goals, and the prior art it builds on."
---

_Architecture & design_

**Status:** Draft v0.6 · 2026-11-03 (v0.6: M0 on all three desktops, M1 under way · v0.2: testing design, [§12](/design/testing/#12-testing) · v0.3: named Mantou · v0.4: open questions decided, [§17](/design/decisions/#17-decisions-formerly-open-questions) · v0.5: M0 results on Linux, [§4](/design/threading/#4-the-defining-constraint-who-owns-the-main-thread))
**Name:** Mantou (馒头), the plain Chinese steamed bun: Mantou provides a plain, unstyled base, and the app supplies the filling ([§7.3](/design/runtime/#73-public-api-sketch)).
**Packages:** npm `mantou-ui` (the bare `mantou` is taken, see [Q1](/design/decisions/#17-decisions-formerly-open-questions)) · CLI `mantou` · Rust crates `mantou-*` · C ABI prefix `mt_`
**Scope of this draft:** desktop (macOS, Windows, Linux). Mobile and web are out of scope for v1.

---

## 1. Summary

Mantou lets you write desktop apps in TypeScript and TSX, run them on Bun, and show UI that Mantou draws itself on the GPU. It never shows a webview. It has three parts:

- **A thin native core** in Rust, compiled to a C-ABI dynamic library and loaded with `bun:ffi`. It owns the OS event loop, the windows, the UI tree, layout, text, drawing, scrolling, animations, input methods (IME) and accessibility.
- **A TypeScript runtime** that runs the app inside a Bun `Worker`. It turns compiled TSX and fine-grained signals into a stream of tree **ops** and sends them to the core in **one FFI call per JS turn**.
- **A small bootstrap** on Bun's main thread. It starts the Worker and then gives the main thread to the native event loop for the rest of the process's life.

The main thread never runs app JavaScript and never waits for it. That keeps scrolling, resizing and animation smooth while the app's JS is busy or paused for garbage collection.

## 2. Goals and non-goals

### Goals
- Cross-platform desktop apps written entirely in TypeScript/TSX, with full access to npm, Node APIs and Web APIs through Bun.
- Self-drawn UI with an app-owned look, the same on every platform. One rendering code path, built on wgpu.
- Smooth by construction: scrolling, resizing, transitions and input handling must not depend on the JS thread.
- Idle at about 0% CPU. Nothing polls; all work is driven by events.
- Fine-grained updates: no virtual-DOM diffing; a signal change sends only the ops it causes.
- Accessible from v1: screen readers on all three desktops through AccessKit.
- Ships as an app bundle or installer per platform, built from one command.

### Non-goals (v1)
- Wrapping OS widgets (NSButton, Win32 controls, GTK widgets). This is not a "native widgets" toolkit.
- iOS and Android. Bun doesn't run there; see [§15](/design/decisions/#15-alternatives-considered) for what this rules out.
- Running in a browser.
- Pixel-identical text to each platform's own toolkit (see [§8.5](/design/protocols/#85-text) for the trade-off).

## 3. Background and prior art

| | **MyGo** (`egoist/mygo`, @48da1ba) | **NSH** (`longbridge/nsh`, @b13c8c2) | **Mantou** |
|---|---|---|---|
| Who owns the process | Go | Rust host | Bun; the main thread is handed to the native loop |
| Where app code runs | Go, on the main thread | QuickJS on an engine thread | Bun `Worker` (JavaScriptCore, JIT) |
| UI model | Immediate-mode API, rebuilds the tree every frame | Compiled JSX + Solid-style signals (in Rust) | Compiled JSX + Solid signals (in JS) |
| Tree, layout, text | Go: flexbox/grid, OS text engines | Rust: Taffy, OS text engines | Rust: Taffy, parley |
| Drawing | Own GPU renderer (Metal/D3D11/GL) + CPU fallback | Native views per node (AppKit, GTK 4, Direct2D) or GPUI | wgpu, MyGo-style instanced quads |
| Web/Node APIs | n/a | Re-implemented in Rust | Provided by Bun |

### What we take from each

- **From MyGo:** frames are drawn only when asked for, so an idle window costs nothing. The scene is a flat list of operations. The renderer draws one instanced quad per operation with a signed-distance-field (SDF) shader for rounded rects, borders and shadows, plus glyph atlases. Layout results are cached and reused when an element hasn't changed.
- **From NSH:**
  - The app UI never waits for JS. One JS turn produces one commit.
  - The core keeps a shadow tree; JS only sends mutations.
  - Text is measured off the main thread and cached by content hash plus width.
  - Removing a node only detaches it; freeing it is a separate step.
  - A node already in place is never re-inserted.
  - During a resize, the app waits a bounded time for the new layout.
  - Layout rounds to device pixels, not whole points.
- **Electrobun and `webview-bun`** prove that Bun desktop apps can be packaged and shipped. They render in a webview, so they're useful for packaging ideas, not for rendering.
