---
title: "Rendering and input"
description: "The frame pipeline, scene, wgpu renderer, scrolling and animation, plus input, focus, accessibility and platform services."
---

## 9. Rendering

### 9.1 Frame pipeline
1. **Commit (Worker thread, inside `mt_commit`):** apply ops → mark dirty → incremental Taffy layout → text layout → rebuild the scene for dirty subtrees → publish `Arc<Scene>` → `EventLoopProxy` sends "scene ready" → winit `request_redraw`.
2. **Composite (main thread, on `RedrawRequested`):** take the latest scene, apply the native scroll offsets and the running compositor animations, build instance buffers, draw, present.
3. **Resize (main thread):** lock the tree, lay out at the new size (bounded wait), rebuild the scene and draw. JS is involved only if components read the window size.

### 9.2 The scene
- A flat list of operations in device pixels: rounded rect (fill, gradient, per-side border, dashes), shadow (outer and inset), glyph run, image, push/pop clip (rounded), and later effect and canvas.
- Layers: scroll containers and nodes with a running transform or opacity animation form a layer. Its transform is applied at composite time, so scrolling and these animations need no relayout and no scene rebuild.

### 9.3 Renderer (wgpu)
**Status:** one pipeline draws every quad in paint order: filled rectangles with rounded corners and borders (an SDF in the fragment shader), and glyphs from the atlas. Each quad carries a clip rectangle (`overflow: hidden`, intersected down the tree). Box shadows (`boxShadow`: offset, blur, spread, colour, following the corner radius) are one extra quad under the box, drawn as far as the blur reaches, with the rounded box's distance turned into coverage by the error function, the closed form of a Gaussian blur across an edge ([#12](https://github.com/dunkbing/mantou/issues/12)). Reference images (`tests/images/shadows@*.png`) check them. Inset shadows, gradients, images and rounded clips aren't built yet.

- One instanced quad per operation. An "uber" fragment shader computes the SDF for rounded rects, analytic blurred shadows (Evan Wallace's method), gradients, border dashes, atlas coverage and the innermost rounded clip. Outer clips become scissor rects.
- Batches share a scissor rect and a texture. Operations completely hidden by a later opaque fill are dropped.
- Frames are drawn only when asked for: something changed, a scroll or animation is running, or the window resized. With nothing pending, the display link stays paused.
- **Later:** damage tracking, a CPU fallback (tiny-skia) for machines without a usable GPU, a canvas API.

### 9.4 Scrolling and animation
- **Scrolling** belongs to the core: wheel and trackpad input, momentum (taken from the OS where it provides it), rubber-banding and scrollbars. JS receives throttled `SCROLL` events only if it listens for them.
  - **Status:** implemented for `overflow: "scroll"` views ([Scrolling and dialogs](/progress/scrolling/)): the wheel and trackpad on the main thread with no relayout, a draggable overlay thumb, `SCROLL_TO` and `SCROLL_INTO_VIEW` applied after the batch's layout, and `SCROLL` events at most once per placement. Rubber-banding, keyboard scrolling and virtualized lists aren't yet.
- **Virtualized lists:** the core asks JS for rows by index as they come into view (`LIST_NEED(rows)`), and JS answers with ops. Rows that leave the view are recycled, with new item signals bound to them.
- **Animations:**
  - Declarative transitions on style props (`transition={{ opacity: 200 }}`) and an `animate()` command run in the core, with timing curves and springs.
  - Animations of compositor props (transform, opacity, colour) run on the main thread without relayout.
  - Animations of layout props relayout once per frame under the lock.

## 10. Input, focus, accessibility, platform services

- **Hit-testing and focus:** the core, on the main thread, against the last layout. Tab order comes from tree order plus `tabIndex`. Focus rings are drawn by the core.
- **IME:** winit's `Ime` events plus `set_ime_cursor_area`, from the caret of the focused input. The composition is drawn inline.
- **Accessibility:** the core builds an AccessKit tree from the shadow tree: roles and labels from props, values, ranges and states. It updates it after each commit when assistive technology is active. Actions are performed natively where possible (focus, scroll, set a value); otherwise they arrive as `A11Y_ACTION` events.
- **Platform services:** menus (app, context, tray), file dialogs, the clipboard, notifications, multiple windows and DPI changes, exposed as async TS functions that go through `COMMAND` / `COMMAND_RESULT`.
