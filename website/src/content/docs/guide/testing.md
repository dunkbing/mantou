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
