---
title: Events and input
description: Presses, pointer events, keys, scrolling, focus, and drag and drop.
---

Handlers go on `View`, `Text` and `Scroll`. Pointer events **bubble** from the node under the pointer up to the root; call `e.stopPropagation()` to stop.

## Press

```tsx
<View onPress={(e) => open(item)} />
```

A press is a down and an up on the same node. A view with `onPress` is a button to screen readers.

## Pointer

```tsx
<View
  onPointerDown={(e) => (start = e.x)}
  onPointerMove={(e) => e.buttons && setWidth(e.x - start)} // keeps coming while a button is held, even outside the view
  onPointerUp={save}
  onContextMenu={(e) => showMenu(items, { x: e.x, y: e.y })} // right-click, or Ctrl+click on a Mac
  onDoubleClick={() => edit()}
/>
```

The event has `x`, `y`, `button`, `buttons`, `shift`, `ctrl`, `alt`, `meta` and `clicks`. This is enough for sliders, splitters and drawing.

## Keys

```tsx
onKey((e) => {
  if (e.key === "ArrowDown") next();
  if (e.meta && e.key === "k") openSearch();
});
```

`e.key` is a character (`"j"`) or a name (`"Enter"`, `"Escape"`, `"ArrowDown"`).

## Scrolling and layout

- `onWheel` hears the wheel; `onScroll` the offset after the core scrolled; `onLayout` the box after layout.
- `node.scrollTo({ y })`, `scrollBy`, `scrollIntoView` scroll from code.
- `node.measure()` returns the box now.

## Focus

Inputs take focus with a click or Tab. `<View focusScope>` keeps Tab inside a dialog, and gives focus back when it closes.

## Drag and drop

Files dropped on the window, and views dragged inside the app, use the same two handlers:

```tsx
<View draggable={{ id: mail.id }} />                       // drag after moving 4 px

<View
  onDragOver={(e) => setOver(e !== null)}                  // null when it leaves
  onDrop={(e) => (e.files.length ? attach(e.files) : move(e.data.id))}
/>

onFileDrop((kind, e) => {}); // files nobody took: 0 over, 1 left, 2 dropped
```
