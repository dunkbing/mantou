---
title: "Overview"
description: "What Mantou is, its goals and non-goals, and the design principles it builds on."
---

**Name:** Mantou (馒头), the plain steamed bun: a plain base, and the app supplies the filling. **Packages:** npm `mantou-ui`, CLI `mantou`, Rust crates `mantou-*`. **Scope:** desktop (macOS, Windows, Linux).

This section is background for people working on Mantou itself. To build an app, start with the [guide](/guide/getting-started/).

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
- iOS and Android. Bun doesn't run there; see [§14](/design/decisions/#14-alternatives-considered) for what this rules out.
- Running in a browser.
- Pixel-identical text to each platform's own toolkit (see [§8.5](/design/protocols/#85-text) for the trade-off).

## 3. Background and design influences

| | **Mantou** |
|---|---|
| Who owns the process | Bun; the main thread is handed to the native loop |
| Where app code runs | Bun `Worker` (JavaScriptCore, JIT) |
| UI model | Compiled JSX + Solid signals (in JS) |
| Tree, layout, text | Rust: Taffy, parley |
| Drawing | wgpu, instanced quads |

### Design principles

- Frames are drawn only when asked for, so an idle window costs nothing.
- One JS turn produces one commit. The core keeps a shadow tree; JS only sends mutations.
- Removing a node only detaches it; freeing it is a separate step. A node already in place is never re-inserted.
- The renderer draws one instanced quad per operation (rounded rects, borders and shadows by a distance-field shader, plus glyph atlases).
- Layout is cached and reused when an element hasn't changed, and rounds to device pixels.
