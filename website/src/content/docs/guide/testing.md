---
title: Testing
description: Test your UI with bun test, against the real core, without a window.
---

`mantou-ui/headless` runs your app on the real layout and text engine with no window, so tests check what a user would see.

```bash
# bunfig.toml
preload = ["mantou-ui/preload"]
```

```tsx
import { expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { Counter } from "./Counter";

test("pressing + counts", () => {
  const h = new HeadlessCore();
  let plus!: any;
  mount(h.ui, () => <Counter ref={(n) => (plus = n)} />);
  h.step();
  h.press(plus);
  h.press(plus);
  expect(h.scene()).toContain("2");
  h.free();
});
```

## What you can do

| | |
|---|---|
| `press(node \| [x, y])`, `hover(...)`, `pointer("down" \| "up" \| "move", x, y)` | Mouse |
| `key("Enter", { ctrl: true })`, `type("hello")`, `value(inputNode)` | Keyboard and inputs |
| `wheel(x, y, dy)`, `resize(w, h)`, `step(ms)` | Scrolling, window size, animation time |
| `rect(node)`, `hit(x, y)`, `scene()` | Where things are, what is drawn |
| `capture()` | A screenshot as pixels, for image comparison |
| `answer(value)`, `chooseMenu(id)`, `dropFiles(...)` | Answer a dialog, pick a menu item, drop files |
| `accessibility()` | The screen-reader tree as text |

Tests wait for conditions, not time: `step()` runs the app until nothing changes.

## Finding out why it looks wrong

- `MANTOU_DEBUG=layout bun run dev` outlines every box in the window, a colour per node, so you can see which view takes the space (the usual cause is `flexShrink` or a missing `minHeight: 0`).
- `dumpTree()` returns the tree as text, one line per node with its box in logical px and its text. Print it from a test or an `onKey` handler:

```tsx
import { dumpTree } from "mantou-ui";
console.log(dumpTree());
// View#1 0,0 360×240
//   View#2 0,0 360×240
//     Text#3 24,24 40.5×39 "0"
```
