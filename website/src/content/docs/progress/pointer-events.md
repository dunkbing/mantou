---
title: Pointer events
description: "onPointerDown, onPointerMove, onPointerUp, onContextMenu and onDoubleClick on views, with capture while a button is held."
---

[#34](https://github.com/dunkbing/mantou/issues/34). Views take pointer handlers that bubble like presses. The core works out the target and sends one `NODE_POINTER` event per down, up or move (moves are coalesced to one per batch, so a drag costs one event per turn).

```tsx
<View
  onPointerDown={(e) => { start = e.x; }}
  onPointerMove={(e) => e.buttons && setWidth(e.x - start)}   // also outside the node during a drag
  onPointerUp={() => save()}
  onContextMenu={async (e) => { const id = await showMenu(items, { x: e.x, y: e.y }); }}
  onDoubleClick={() => open(item)}
/>
```

The event has `x`, `y` (logical px), `button` (0 primary, 1 middle, 2 secondary), `buttons` (held, a bit per button), `shift`/`ctrl`/`alt`/`meta`, `clicks` and `stopPropagation()`.

- **Capture:** the node under the first press of a hold hears every move and release until all buttons are up, wherever the pointer goes.
- **Context menu:** the secondary button, and on macOS Control + the primary button (that one also fires `onPointerDown`).
- **Tests:** `tests/pointer.test.tsx`; headless instances take `h.pointerButton("down", 2, x, y)` for the other buttons.

Not done: touch, pen, wheel-as-pointer, `setPointerCapture` for an explicit capture, and a `pointerenter`-style move without a listener on the node itself.
