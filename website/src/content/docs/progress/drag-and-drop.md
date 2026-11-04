---
title: Drag and drop
description: "Files dropped on the window: onDrop and onDragOver on views, and onFileDrop for the window."
---

[#36](https://github.com/dunkbing/mantou/issues/36). Files dragged from the OS onto the window arrive as one `FILE_DROP` event (held over, left, dropped), with the paths and the pointer's position.

```tsx
<View onDragOver={(e) => setOver(e !== null)} onDrop={(e) => attach(e.files)} />
onFileDrop((kind, e) => {}); // kind 0 over, 1 left, 2 dropped: only when no view took it
```

- The target is the topmost view with a drop listener under the pointer's **last known position**: winit gives no position for OS drags, so a drag that starts outside the window can be routed to the wrong view. A window-level `onFileDrop` is always right.
- `onDragOver` hears `null` when the files move to another view or leave the window.
- Tests: `tests/drop.test.tsx` (`HeadlessCore.dropFiles`).

## Dragging a view inside the app

```tsx
<View draggable={{ id: mail.id }} />                       // after 4 px with the primary button held
<View onDragOver={(e) => setOver(e !== null)} onDrop={(e) => move(e.data.id)} />
```

Targets get the same `onDragOver` / `onDrop` as for files; `e.data` is the dragged view's value (and `files` is empty). The target is found with a hit test at the pointer, so the dragged view itself and its children are never one. Nothing is drawn for the drag itself: style the source and targets from state.

**Not done yet:** dragging files or text out of the app, a drag image, and a check of a real drop in a window (needs a person or Finder automation).
