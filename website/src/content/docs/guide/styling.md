---
title: Styling
description: Style properties, shared styles, fonts and animation.
---

`style` is an object of CSS-like properties. Numbers are logical pixels; colours are `#rgb`, `#rrggbb`, `#rrggbbaa`, `"transparent"` or `[r, g, b, a]`.

## Layout

Layout is **flexbox**, as in CSS, with these defaults: `flexDirection: "column"`, `position: "relative"`, and `flexShrink: 1`.

| | |
|---|---|
| Flex | `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`, `justifyContent`, `alignItems`, `alignSelf`, `alignContent`, `gap`/`rowGap`/`columnGap` |
| Size | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` |
| Space | `padding*`, `margin*` |
| Position | `position: "relative" \| "absolute" \| "fixed" \| "sticky"`, `top`, `right`, `bottom`, `left` |
| Grid | `display: "grid"`, `gridColumns`, `gridMinColumnWidth`, `gridColumnSpan`, `gridRowSpan` |
| Other | `aspectRatio`, `pointerEvents` |

`absolute` is placed against the parent, `fixed` against the window (it stays put while content scrolls), and `sticky` stays at the given distance from the top, bottom, left or right of its scroll view while its parent is in view.

```tsx
<Scroll>
  <View style={{ position: "sticky", top: 0, backgroundColor: "#fff" }}>Section A</View>
  …
</Scroll>
```

## Grid

```tsx
<View style={{ display: "grid", gridColumns: 3, gap: 8 }}>          {/* three equal columns */}
  <Image style={{ aspectRatio: 1 }} />                                {/* square */}
  <View style={{ gridColumnSpan: 2 }} />                              {/* two columns wide */}
</View>

<View style={{ display: "grid", gridMinColumnWidth: 160, gap: 8 }}>  {/* as many columns as fit */}
```

Columns are equal-width; there is no way to mix fixed and flexible tracks yet. `aspectRatio` is width ÷ height for a box where one of them is known. `pointerEvents: "none"` makes a view invisible to the pointer: presses, hover and the cursor go to what is below it.

## Layout gotchas

Two things catch people out:

- Fixed-size parts need `flexShrink: 0`, or they shrink to fit.
- A scrolling child inside a column needs `minHeight: 0` on its ancestors.

## Looks

| | |
|---|---|
| Colour | `backgroundColor`, `opacity` |
| Borders | `borderRadius`, `borderWidth`, `borderColor`; one corner: `borderTopLeftRadius`…; one side: `borderTopWidth`…; one side's colour: `borderTopColor`… (the others use `borderColor`; the sides meet along the diagonals at the corners) |
| Gradient | `backgroundColor` to `gradientColor`, at `gradientAngle` degrees (180, the default, runs top to bottom; 90 left to right); `gradientMidColor` (at `gradientMidAt` percent, default 50) adds a third stop; `gradientShape: "radial"` runs from the centre to the corners. A see-through end colour (`"#ffffff00"`) fades out |
| Stacking | `zIndex`: higher is painted and hit on top of its siblings |
| Shadow | `shadowX`, `shadowY`, `shadowBlur`, `shadowSpread`, `shadowColor` |
| Clipping | `overflow: "visible" \| "hidden" \| "scroll"`; a clipping view with `borderRadius` clips to the rounded corners |
| Filters | `brightness`, `saturate`, `contrast` (1 = unchanged) and `invert` (0 = unchanged, 1 = opposite colours) on a view and what's inside it; nested ones combine. No blur yet |
| Transform | `translateX`, `translateY`, `scale`, `rotate` in degrees clockwise (they move what is drawn, not the layout) |
| Pointer | `cursor` (`"pointer"`, `"text"`, `"grab"`…) |
| Images | `objectFit` |

`rotate` turns a view and everything inside it about its centre, and the pointer follows. For now `overflow` clips to the box around a turned view (not its rounded shape), a click in a text field inside it puts the caret in the wrong place, and scroll bars stay upright.

## Text

`color`, `fontSize`, `fontWeight`, `fontStyle`, `fontFamily`, `lineHeight`, `textAlign`, `maxLines`, plus:

| | |
|---|---|
| `textDecoration` | `"none"`, `"underline"`, `"lineThrough"` |
| `letterSpacing` | px added after each character |
| `textTransform` | `"uppercase"`, `"lowercase"`, `"capitalize"` |
| `whiteSpace` | `"nowrap"` or `"pre"`: one line per paragraph (line breaks in the text are kept) |
| `wordBreak` | `"breakAll"`, `"keepAll"`, `"breakWord"` (only a word too long for the line breaks) |
| `userSelect` | `"text"` lets the user select a `<Text>` (same as the `selectable` prop) |
| `textOverflow` | `"ellipsis"` (default) or `"clip"` for what `maxLines` or `nowrap` cuts off |
 Inputs also take `placeholderColor`, `caretColor`, `selectionColor`.

The default font is Inter, with the platform's colour emoji font and then the system's fonts after it, so emoji and scripts Inter lacks (CJK, Hebrew, Arabic…) still draw. To use your own:

```tsx
run(App, { fonts: ["assets/Serif.ttf"] });
<Text style={{ fontFamily: "My Serif" }}>…</Text>
```

## Shared styles

Use `defineStyle` for a style used many times; it is sent once, then each node references it.

```tsx
const card = defineStyle({ padding: 16, borderRadius: 12, backgroundColor: "#fff" });
<View style={card} />
<View style={[card, { opacity: 0.5 }]} />
```

## Animation

Animation runs in the core, not in your code. Say which properties animate and set them:

```tsx
<View
  transition={{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }}
  style={{ opacity: hovered() ? 1 : 0.6, scale: pressed() ? 0.97 : 1 }}
/>
```

Animatable: `opacity`, `translateX`, `translateY`, `scale`, `rotate`, `backgroundColor`, `borderColor`, `color` (and `layout`, below). A spring instead of a duration: `transition={{ translateY: { spring: { stiffness: 300, damping: 20 } } }}`. It overshoots when `damping` is under about `2 × √stiffness` and settles at the end; the duration comes from the spring.

For a one-off, call `node.animate` with a property and options. It returns `{ finished, stop }`:

```tsx
node.animate("opacity", { from: 0, to: 1, duration: 300, easing: "ease-out" });
node.animate("scale", { keyframes: [1, 1.2, 0.95, 1], duration: 400 });   // evenly spaced steps
node.animate("translateY", { from: 40, to: 0, spring: { stiffness: 250, damping: 18 } });
node.animate("rotate", { from: 0, to: 360, duration: 900, easing: "linear", iterations: Infinity }); // a spinner
```

A movement that gets a new target mid-way keeps its speed: it carries on, slows and turns towards the new value instead of stopping dead. Opacity and colours never overshoot, even with a bouncy spring, and colours mix in OKLab, so a fade from red to blue passes through purple rather than grey.

### Reduced motion, instant changes, slow motion

```tsx
import { instant, useReducedMotion, setReducedMotion, setAnimationSpeed } from "mantou-ui";

instant(() => setTab(restoredTab));     // applied at once: no transitions, nothing slides into place
const reduced = useReducedMotion();      // a signal: the OS setting, unless the app chose
setReducedMotion(true);                  // or false, or "system"
setAnimationSpeed(0.25);                 // animations four times slower, to look at them
```

With reduced motion on (the OS's accessibility setting, or the app's choice), movement — translate, scale, rotate and layout transitions and animations — jumps to its end, and a running spinner stops; fades and colour changes still play. `MANTOU_REDUCED_MOTION=1` (or `0`) overrides the OS for a run.

### Animating layout

Add `layout` to a view's `transition` and it slides to its new place when layout moves it, for example when siblings are added, removed or reordered. The core does it as a translation from where the box was drawn, so there's no JS per frame, and `onLayout` still reports where layout put it.

```tsx
<For each={items()}>
  {(item) => <Row transition={{ layout: { spring: { stiffness: 300, damping: 30 } } }} item={item()} />}
</For>
```

Nodes without the transition jump as before.

### Enter and exit

`enter` starts a new view from the given values; `exit` keeps a removed view on screen while it moves to the given values, then removes it. Both take a duration (default 200 ms) and easing, or a spring.

```tsx
<Show when={open()}>
  <Panel enter={{ from: { opacity: 0, translateY: 12 } }} exit={{ to: { opacity: 0 }, duration: 150 }} />
</Show>
```

A leaving view ignores the pointer, and is gone from the app's tree at once.

## Light and dark

`useColorScheme()` is a signal of the system's scheme (`"light"` or `"dark"`) that follows the OS. On Linux it comes from the desktop's appearance setting through the XDG desktop portal (GNOME, KDE Plasma and others), followed as it changes, with GNOME's settings as a fallback; `MANTOU_COLOR_SCHEME=dark` (or `light`) overrides it for a run. `defineTheme` gives each scheme its values; what it returns changes with the scheme wherever it is used, so nothing else needs to read the signal.

```tsx
import { defineTheme, useColorScheme, setColorScheme } from "mantou-ui";

const theme = defineTheme({
  light: { bg: "#ffffff", text: "#111827" },
  dark: { bg: "#111827", text: "#f9fafb" },
});

<View style={{ backgroundColor: theme.bg }}>
  <Text style={{ color: theme.text }}>Hello</Text>
</View>

setColorScheme("dark");   // an in-app setting; "system" goes back to following the OS
```

A theme can be made at module load, before the window exists. Values written into a plain object are read once, so a shared style that uses a theme takes a function, which is read again when the scheme changes:

```tsx
const card = defineStyle(() => ({ backgroundColor: theme.bg, padding: 12 }));
```

## Hover

```tsx
<View onHover={(on) => setHot(on)} style={{ cursor: "pointer" }} />
```

The core tracks the pointer, so hover costs nothing while the pointer is still.
