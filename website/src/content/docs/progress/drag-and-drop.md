---
title: Drag and drop
description: "Files dropped on the window, views dragged inside the app with a preview that follows the pointer, onDrop and onDragOver on views."
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

Targets get the same `onDragOver` / `onDrop` as for files; `e.data` is the dragged view's value (and `files` is empty). The target is found with a hit test at the pointer, so the dragged view itself and its children are never one.

### The preview

`dragPreview={() => <View>…</View>}` is mounted when the drag starts (in a root of its own under the component's owner, so it has the app's context), appended to the root as a fixed view, and handed to the core with `FOLLOW_POINTER` (id, the grab point). The core places it at the pointer minus the grab point on every pointer move, on the main thread: no ops, no relayout. Hit tests skip it and everything inside it. When the drag ends (a drop, or Escape) it's removed and disposed, which releases its nodes.

| What | Where it's tested |
|---|---|
| The node moves with the pointer, placed without a layout; hit tests go through it and its children; off again, it's back; released, it stops | `core/crates/mantou-tree/tests/follow.rs` |
| The preview appears at the grab point, follows with no commits, isn't hit, and is released on drop | `tests/drop.test.tsx` |
| Escape: the target hears it leave, nothing drops, the preview goes, no new drag until the next press | `tests/drop.test.tsx` |
| In a window: 20 moves with the Worker blocked, 0 commits, the preview ends at the last position | self-test, check 14 |

**Not done yet:** dragging files or text out of the app to other apps. winit can't start an OS drag. The `drag` crate can on macOS and Windows, but on Linux it needs a GTK window, which Mantou's winit window isn't. A check of a real Finder or Explorer drop in a window is also still to do.
