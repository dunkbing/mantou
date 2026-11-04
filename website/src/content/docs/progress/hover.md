---
title: Hover and cursors
description: "onHover and the cursor style: the core tracks the pointer, tells only the nodes that listen, and sets the cursor with no JS round trip."
---

Asked for in [#18](https://github.com/dunkbing/mantou/issues/18): buttons and rows that highlight under the pointer, links, splitters.

```tsx
import { Text, View, createSignal } from "mantou-ui";

function Button(props: { label: string; onPress: () => void }) {
  const [hot, setHot] = createSignal(false);
  return (
    <View
      onPress={props.onPress}
      onHover={setHot}
      transition={{ backgroundColor: 120 }}
      style={{ cursor: "pointer", padding: 10, borderRadius: 8, backgroundColor: hot() ? "#1d4ed8" : "#2563eb" }}
    >
      <Text style={{ color: "#ffffff" }}>{props.label}</Text>
    </View>
  );
}
```

## Hover

- `onHover={(hovered) => …}` hears `true` when the pointer comes over the node or anything inside it, and `false` when it leaves. `onPointerEnter` and `onPointerLeave` are the same, one way each. `node.onHover(fn)` and `node.hovered` do it from code.
- Like the DOM's `mouseenter` and `mouseleave`, they don't bubble: every listening node on the path hears its own, the outermost first on the way in and the innermost first on the way out.
- The core works the hovered path out again whenever the pointer moves and whenever boxes are placed again: a layout, a scroll, an animation. So a row that scrolls away from a still pointer is left, and the one that scrolls under it is entered. Leaving the window leaves everything. Hit-testing follows transforms, so a view is hovered where it's drawn.
- A node that's hidden or removed under the pointer is left. A released node hears nothing (its handlers went with it).
- Only nodes with hover handlers are told (`LISTEN` with the `Hover` bit), so moving the pointer over an app without them sends no events.

## Cursors

The `cursor` style sets the pointer's shape over a node and the nodes inside it that don't set their own: `default`, `pointer`, `text`, `grab`, `grabbing`, `notAllowed`, `move`, `crosshair`, `wait`, `progress`, `help`, `ewResize`, `nsResize`, `neswResize`, `nwseResize`, `colResize`, `rowResize` and `none`. With `auto` (the default), inputs show the text cursor and everything else the arrow; scrollbar thumbs show the arrow.

The window changes the cursor on the main thread as the pointer moves, and again when what's under it changes, with no JS round trip.

## How it works

- Events `POINTER_ENTER` and `POINTER_LEAVE` (node), the `Hover` listen bit, and the `cursor` style property ([the protocol](/design/protocols/)).
- `Tree::pointer_at` takes the pointer's position (or `None` outside the window); `Tree::cursor` answers which cursor to show.
- Headless: `h.hover(node or [x, y])`, `h.unhover()` and `h.cursor()`.

## Tests

- `core/crates/mantou-tree/tests/hover.rs`: enter and leave order with nested listeners, moving inside a node, leaving the window, nodes that move, hide or are released under a still pointer, scrolling under a still pointer, a listener added while hovered, transformed views, and which cursor wins.
- `tests/hover.test.tsx` (headless): a button with `onHover` and a cursor (one style op each way), rows in a scroll view, the text cursor over inputs, a node swapped under the pointer.
- `runtime/hover.test.tsx` (mock): the listen bit, repeated states heard once.
- The window self-test: the cursor is the text cursor over an input and the arrow off it.

**Not yet:** `:active`-style pressed state as an event, drag and drop, custom cursor images.
