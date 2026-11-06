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
  mount(h.ui, () => <Counter />);   // <View testId="add" …>, <Text testId="count">
  h.step();
  h.press("add").press("add");
  expect(h.find("count")!.textContent).toBe("2");
  h.free();
});
```

Give what a test needs to find a `testId`: any element takes one, it costs nothing in the core, and `press`, `hover`, `scroll`, `rect`, `value` and `tree` take it in place of a node. A missing one fails with the testIds there are, so a typo explains itself.

## What you can do

| | |
|---|---|
| `find("id")`, `findAll("id")` | Nodes by `testId` |
| `press(target)`, `hover(target)`, `pointer("down" \| "up" \| "move", x, y)` | Mouse; a target is a node, a testId or `[x, y]` |
| `key("Enter", { ctrl: true })`, `type("hello")`, `value(target)` | Keyboard and inputs |
| `scroll(target, dy)`, `wheel(x, y, dy)`, `resize(w, h)`, `step(ms)` | Scrolling, window size, animation time |
| `tree()`, `treeText()` | The screen as a tree: testIds, text, boxes as drawn, what's clipped or hidden, opacity, animating |
| `rect(target)`, `hit(x, y)`, `scene()` | Where things are, what is drawn |
| `strip({ frames, every, cols, crop })` | An animation as one image (a contact sheet) |
| `checkMotion(act, { ms, allow })` | Jumps, flicker and animations that never end, after `act` |
| `capture()` | A screenshot as pixels, for image comparison |
| `answer(value)`, `chooseMenu(id)`, `dropFiles(...)` | Answer a dialog, pick a menu item, drop files |
| `accessibility()` | The screen-reader tree as text |

Tests wait for conditions, not time: `step()` runs the app until nothing changes.

## The screen as text

`h.treeText()` (or `h.tree()`, the same as JSON) is what's on screen, one node per line:

```
View#1 0,0 480×360
  Text#3 [count] "2" 213,127 53×49
  View#4 [plus] 180,192 120×40 role=button label="Add one"
  View#6 [list] 0,240 480×120
    Text#9 [row-3] "Bread" 0,330 480×30 clipped
    Text#10 [row-4] "Milk" 0,360 480×30 hidden
  View#12 [toast] 160,20 160×40 opacity=0.4 animating
```

Boxes are as drawn: transforms and running animations included, so a sliding panel shows where it is now. `clipped` and `hidden` say what a scroll view or an `overflow: hidden` parent cuts; `opacity` is with its ancestors'.

## Motion

```tsx
setOpen(true);
writeFileSync("open.png", encodePng(h.strip({ frames: 12, every: 33, cols: 4 })));   // the animation, 12 frames
expect(h.checkMotion(() => setOpen(false))).toEqual([]);                            // no jumps, flicker or endless loops
```

`checkMotion` plays the clock frame by frame and reports a `jump` (an animating box's speed changes abruptly: a restart from rest, a snap mid-flight), `flicker` (opacity going back and forth) and `never-settles` (pass `allow: ["spinner"]` for the ones that should).

## Without a test: `mantou snap`

`mantou snap` runs your app's own entry headless and prints the screen as a tree; nothing to write first. It's how an agent (or CI) looks at an app:

```bash
mantou snap src/main.tsx --out shot.png                     # the tree, and a screenshot at 2×
mantou snap src/main.tsx --script '[{"press":"plus"},{"type":"hi","into":"name"},{"wait":300}]'
mantou snap src/main.tsx --scene empty --tree tree.json      # start from a named state
mantou snap src/main.tsx --script open.json --strip open.png --check-motion
```

- `run()` mounts into a headless instance instead of a window, at `run()`'s size (or `--size 800x600`). A module with a component as its default export works too.
- Scenes are the entry's `export const scenes = { empty: () => setItems([]) }`: named functions that set the app's state (keep it in modules), applied with no transitions. `--list-scenes` lists them.
- Script steps: `press`, `hover`, `type` (with `into`), `key` (with `mods`), `scroll` (with `dy`), `wait` (ms of the clock), `resize`, `scene`, and `snap` and `tree` to write files mid-way. Targets are testIds or `[x, y]`.
- `--dark`, `--light` and `--reduced-motion` set the system's settings; `--at MS` stops the clock mid-animation.
- It exits 1, with a message, when a target or a scene isn't there, or when `--check-motion` finds something.

`mantou dev --snap` writes `.mantou/dev-snap.png` and its tree (`dev-snap.txt`) after every start and reload, so an agent editing the app can read what its change did.

## Performance warnings

`mantou dev` watches the core's counters and says, once each, when the app does work the framework would do better: a commit almost every frame (an animation driven from JS: use `transition` or `animate()`), frames that take long in the core (with where the time goes), ops the core rejected, and very large trees (use `<List>`). `MANTOU_PERF_WARN=0` turns them off.

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
