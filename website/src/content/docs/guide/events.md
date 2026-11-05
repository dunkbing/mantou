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

`onKey` on a view hears keys while it, or something inside it, has the focus. Keys go to the focused node first, then bubble up through its ancestors to the window's `onKey` handlers; `e.stopPropagation()` stops them. Keys the core uses never come: typing in an input, Tab, Enter and Space on a focused view, and keys a focused scroll view scrolls with.

## Scrolling and layout

- `onWheel` hears the wheel; `onScroll` the offset after the core scrolled; `onLayout` the box after layout.
- `node.scrollTo({ y })`, `scrollBy`, `scrollIntoView` scroll from code.
- `node.measure()` returns the box now.

## Focus

Inputs take focus with a click or Tab. A view does too with `focusable`:

```tsx
<View focusable onPress={save} onFocus={…} onBlur={…} style={{ focusRingColor: "#16a34a" }}>…</View>
```

- Tab and Shift+Tab move through inputs and focusable views in tree order. With nothing focused, Tab goes to the first. `tabIndex={-1}` leaves a view out of Tab (a press or `node.focus()` still focuses it); `tabIndex={1}`, `2`… go first, in that order.
- A press focuses it. Enter and Space press a focused view that has `onPress`, so keyboard users can use your buttons.
- The core draws a ring around a focused view when the focus came from the keyboard (Tab, or `focus()` after a key), not after a press, like CSS's `:focus-visible`. Style it with `focusRingColor` (transparent for none) and `focusRingOffset` (px outside the border box; default 2).
- `<Scroll focusable>` scrolls with the keys once focused: the arrows, Page Up and Page Down, Space and Shift+Space, Home and End. A focused view inside a scroll view pages it (Page Up and Down, Home, End) and leaves the arrows to the app. The core scrolls it, like the wheel.

`<View focusScope>` keeps Tab inside a dialog, and gives focus back when it closes.

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

To show something under the pointer while a view is dragged, give it a `dragPreview`. It's made when the drag starts, held where the view was grabbed, and moved by the core with no JS. The pointer goes through it to the targets underneath, and it's released when the drag ends. Escape cancels a drag: the target hears it leave and nothing drops.

```tsx
<View
  draggable={{ id: mail.id }}
  dragPreview={() => <View style={{ padding: 8, borderRadius: 8, backgroundColor: "#2563eb" }}><Text style={{ color: "#fff" }}>{mail.subject}</Text></View>}
/>
```
