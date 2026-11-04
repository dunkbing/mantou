---
title: Scrolling and dialogs
description: "Scroll views scrolled by the core (wheel, trackpad, a draggable thumb, scrollIntoView), focus scopes for dialogs, and password inputs."
---

Three things Mantou Mail asked for ([#5](https://github.com/dunkbing/mantou/issues/5), [#6](https://github.com/dunkbing/mantou/issues/6), [#7](https://github.com/dunkbing/mantou/issues/7)).

## Scroll views

```tsx
import { For, Scroll, createEffect, type Node } from "mantou-ui";

let list!: Node;
const rows = new Map<string, Node>();

<Scroll ref={list} style={{ flexGrow: 1, minHeight: 0 }} onScroll={(o) => setOffset(o.y)}>
  <For each={messages()}>{(m) => <Row ref={(n) => rows.set(m.id, n)} message={m} />}</For>
</Scroll>;

createEffect(() => rows.get(selected().id)?.scrollIntoView({ block: "nearest" })); // keep the selection in view
list.scrollTo({ y: 0 }); // back to the top
```

- **The core scrolls them.** Any view with `overflow: "scroll"` is a scroll view; `<Scroll>` is one with its children in a content view that keeps their full size. The wheel and the trackpad scroll the innermost scroll view under the pointer that can still move that way, on the window's main thread: no round trip through JS, no relayout (the core keeps each view's offset and applies it when it places boxes). Trackpad momentum comes from the OS.
- **A thumb** is drawn over the content while it overflows (`scrollbar: "auto"`, the default; `"none"` hides it), in `scrollbarColor`, and can be dragged. Presses on it don't reach the content.
- **From the app:** `node.scrollTo({ x?, y? })`, `node.scrollBy({ x?, y? })`, and `node.scrollIntoView({ block })` on any node inside scroll views (`"nearest"`, the default, moves as little as it takes; also `"start"`, `"center"`, `"end"`). They're applied after the turn's layout, so a row added in the same turn can be scrolled to.
- **Listening:** `onScroll` gets `{ x, y }` after the core scrolls the view, at most once per frame, only if something listens. `node.scrollOffset` holds the last one.
- **Limits** are kept as content and viewport change: a list that shrinks or a window that grows leaves the offset within the new limit.

The window self-test sends five wheel turns to a scroll view while the Worker spins in a busy loop: the content moved 200 px and was drawn, with no commit from JS.

**Flexbox, as in CSS:** a scroll view in a flex column needs `minHeight: 0` on it and on its ancestors up to the one with a fixed size; otherwise they grow to fit the content and there's nothing to scroll.

**Not yet:** keyboard scrolling (PageUp/PageDown when a view has the focus; views can't take the focus yet), rubber-banding and smooth (animated) `scrollTo`.

## Virtualized lists

```tsx
let list!: ListHandle;

<List each={messages()} itemHeight={84} overscan={6} ref={(l) => (list = l)} style={{ flexGrow: 1, minHeight: 0 }}>
  {(m) => <Row message={m()} />}
</List>;

list.scrollToIndex(selected(), { block: "nearest" });
```

Only the rows in view, and `overscan` more on each side, exist ([#19](https://github.com/dunkbing/mantou/issues/19)). The list is a scroll view whose content is as tall as all the rows; the core scrolls it with no JS, and the rows come and go as its `onScroll` tells the list where it is (rows that stay in view are untouched). Rows are absolutely positioned at `index × itemHeight`, so `scrollToIndex` reaches rows that don't exist yet. A row's `item` is an accessor, so rows follow changes to `each`. If the app is busy while the user scrolls fast, the core keeps scrolling and the rows past the overscan fill in once JS runs again.

`tests/list.test.tsx` uses 100,000 rows: under 60 nodes exist; each 40 px of scrolling is one row in and one out, with the same ops as for a 1,000-row list; `scrollToIndex` reaches the middle and the end. Rows have one fixed height for now; variable heights come later.

## Focus scopes

`<View focusScope>`, for dialogs: while it's on screen, Tab and Shift+Tab stay among the inputs inside the topmost scope, wherever the focus is. When it leaves the screen (released, removed or hidden), the focus goes back to the input that had it before it opened, unless the user has put it somewhere else since.

## Password inputs

`<Input secure>` draws a bullet per character, refuses copy and cut (paste works), ignores IME compositions and tells the OS it's a password field. Flip `secure` for a "show password" toggle; the text and the caret stay.

## Tests

- **Tree** (`tests/scroll.rs`): the wheel within limits and without a relayout, clipping and hit-testing after scrolling, nested scroll views handing over at their ends, the thumb (drawn, dragged, hidden), `scrollTo`, `scrollBy` and every `scrollIntoView` block for a row added in the same batch, offsets clamped when content shrinks, one `SCROLL` event per placement. Focus scopes and secure inputs in `tests/input.rs` and the editor's tests.
- **Headless** (`tests/scroll.test.tsx`): a 50-message list: the wheel with no commits from JS, a press after scrolling, `j`/`k` kept in view with `scrollIntoView`, `scrollTo`/`scrollBy`, dragging the thumb, a resize. Dialogs and password fields in `tests/input.test.tsx`.
- **Window:** the self-test's "scrolling without JS" check; and the to-do example (`bun run todos`, its list is a `<Scroll>`) driven under Xvfb with real wheel clicks and a thumb drag.
