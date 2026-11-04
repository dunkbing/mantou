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
| Borders | `borderRadius`, `borderWidth`, `borderColor` |
| Shadow | `shadowX`, `shadowY`, `shadowBlur`, `shadowSpread`, `shadowColor` |
| Clipping | `overflow: "visible" \| "hidden" \| "scroll"` |
| Transform | `translateX`, `translateY`, `scale` (they move what is drawn, not the layout) |
| Pointer | `cursor` (`"pointer"`, `"text"`, `"grab"`…) |
| Images | `objectFit` |

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

The default font is Inter. To use your own:

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

Animatable: `opacity`, `translateX`, `translateY`, `scale`, `backgroundColor`, `borderColor`, `color`. For a one-off, `node.animate({ opacity: 0 }, { duration: 300 })`.

## Light and dark

`useColorScheme()` is a signal of the system's scheme (`"light"` or `"dark"`) that follows the OS. `defineTheme` gives each scheme its values; what it returns changes with the scheme wherever it is used, so nothing else needs to read the signal.

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

## Hover

```tsx
<View onHover={(on) => setHot(on)} style={{ cursor: "pointer" }} />
```

The core tracks the pointer, so hover costs nothing while the pointer is still.
