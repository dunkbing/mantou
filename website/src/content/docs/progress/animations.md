---
title: Animations
description: "Transitions and animate(), run by the core on the main thread: opacity, colours and transforms (translate, scale), with no JS per frame."
---

Asked for in [#20](https://github.com/dunkbing/mantou/issues/20): panels that slide, toasts that fade, pressed buttons that shrink, spinners. The core runs every animation ([§9.4](/design/rendering/#94-scrolling-and-animation)): JS says what to animate once, and the main thread draws each frame from the core's clock. A busy or blocked Worker doesn't stop it, and nothing animates by layout.

## Transitions

```tsx
import { Text, View, createSignal } from "mantou-ui";

function Toast(props: { shown: boolean }) {
  return (
    <View
      transition={{ opacity: 150, translateY: { duration: 250, easing: "ease-out" } }}
      style={{ opacity: props.shown ? 1 : 0, translateY: props.shown ? 0 : 24, padding: 12, borderRadius: 8, backgroundColor: "#111827" }}
    >
      <Text style={{ color: "#ffffff" }}>Message archived</Text>
    </View>
  );
}
```

- `transition` maps properties to a duration in ms, or `{ duration, easing }`. Easings are CSS's: `linear`, `ease` (the default), `ease-in`, `ease-out`, `ease-in-out`.
- When a property with a transition changes, it animates from what's drawn now to the new value, so changing it again mid-way doesn't jump. The node's style holds the target from the start: `measure()` and the next transition see it.
- A node's first look doesn't animate (there's nothing to start from). To animate a node in, start it hidden and change the style after it's on screen, or use `animate()`.
- `node.transition({...})` does the same from code. It replaces the node's transitions: properties left out stop transitioning.

## animate()

```tsx
let dot!: Node;
<View ref={dot} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#2563eb" }} />;

const pulse = dot.animate("scale", { from: 1, to: 1.4, duration: 600, easing: "ease-in-out", iterations: Infinity, alternate: true });
// later
pulse.stop();
await pulse.finished;
```

- `animate(prop, { from, to, duration, easing?, iterations?, alternate? })` runs from `from` to `to` (numbers, or colours for colour properties), `iterations` times (1 by default; `Infinity` until stopped), every other one backwards with `alternate`. When it ends, the property goes back to its style's value.
- It returns `{ finished, stop() }`. `finished` settles when the animation ends: it finished (the core sends `ANIMATION_END`), it was stopped, another animation of the same property replaced it, or its node was released.

## What animates

| Property | |
|---|---|
| `opacity` | 0–1, multiplied down the tree |
| `backgroundColor`, `borderColor`, `color` | interpolated in sRGB, alpha included |
| `translateX`, `translateY` | logical px |
| `scale` | about the box's centre |

`translateX`, `translateY` and `scale` are also plain style properties. They're a transform, as in CSS: the node and everything inside it are drawn moved and scaled (borders, radii, shadows, text, images, inputs), and hit-testing, `measure()` and scrolling follow what's drawn. Layout doesn't see them: neighbours stay where they are, and `onLayout` reports the untransformed box, so a sliding panel sends no layout events. Text inside a scaled view is rasterized at the size it's drawn at, so it stays sharp.

Layout properties (`width`, `height`, margins…) can't be animated; animate a transform instead.

## How it runs

- The tree has a clock (`Tree::set_time`). A commit stamps the time, so animations it starts start then; `Tree::tick` advances them, and transforms re-place boxes without a relayout.
- In a window, each frame ticks the animations before drawing and, while any runs, asks for the next frame. Frames follow the display's refresh (vsync); when the last animation ends, the window goes back to drawing nothing.
- Headless instances use their manual clock: `h.step(ms)` advances it and ticks, so tests check values mid-animation exactly.
- Ops: `TRANSITION` (id, prop, duration, easing) and `ANIMATE` (id, animation, prop, from, to, duration, easing, iterations, flags); event `ANIMATION_END` (node, animation). See [the protocol](/design/protocols/).

## Tests

- `core/crates/mantou-tree/tests/anim.rs`: transitions start from what's drawn and end at the style, no transition on a first look, iterations and alternation, replacement and `ANIMATION_END`, scale about the centre with hit-testing, layout events unaffected, released nodes stop.
- `tests/anim.test.tsx` (headless): the `transition` prop on the core's clock with no commits per frame, `animate()`'s promise, `stop()`, colours mid-way, and reference images of transformed views with text at 1× and 2×.
- `runtime/anim.test.tsx` (mock): op counts. A change to a property with a transition is one `STYLE` op.
- The window self-test: an animation keeps drawing while the Worker is blocked (no commits), and the window is idle again once it ends.

Found on the way: headless instances share one renderer, which uploads a glyph atlas only when its version is new to it, and every instance's atlas started at the same version. A second instance could draw its glyphs from the first one's atlas. Atlas versions are now unique in the process.

**Not yet:** springs, rotation, animating layout properties, and a way to wait for transitions from JS.
