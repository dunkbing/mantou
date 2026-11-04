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
| Position | `position: "relative" \| "absolute"`, `top`, `right`, `bottom`, `left` |

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

## Hover

```tsx
<View onHover={(on) => setHot(on)} style={{ cursor: "pointer" }} />
```

The core tracks the pointer, so hover costs nothing while the pointer is still.
