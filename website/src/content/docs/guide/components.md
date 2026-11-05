---
title: Components
description: View, Text, Input, Image, Scroll and List, and the Solid helpers.
---

Import everything from `mantou-ui`.

## View

A box. It takes `style`, children and any of the [event handlers](/guide/events/).

```tsx
<View style={{ flexDirection: "row", gap: 8, padding: 16 }}>…</View>
```

Other props: `transition` (animate style changes, see [styling](/guide/styling/#animation)), `focusable` and `tabIndex` (take the keyboard focus, see [focus](/guide/events/#focus)), `focusScope` (keep Tab inside a dialog), `ref`, and the [accessibility props](/guide/platform/#accessibility).

## Text

Text is only drawn inside `<Text>`, whose children are strings, numbers and other `<Text>`s.

```tsx
<Text style={{ fontSize: 14, color: "#374151", maxLines: 2 }}>Hello, {name()}</Text>
```

A `<Text>` inside a `<Text>` is a span: its text flows with the rest, in its own `fontWeight`, `fontStyle`, `fontSize`, `fontFamily`, `color`, `letterSpacing` and `textDecoration`, and `backgroundColor` highlights it. Everything else (alignment, `maxLines`, wrapping, line height) is the outer Text's. Spans nest, and handle presses, so a link is a span:

```tsx
<Text>
  <Text style={{ fontWeight: 700 }}>{from()}</Text> sent the{" "}
  <Text style={{ backgroundColor: "#fde047" }}>invoice</Text>.{" "}
  <Text onPress={openIt} style={{ color: "#2563eb", textDecoration: "underline", cursor: "pointer" }}>View it</Text>
</Text>
```

A press on a span goes to it first, then bubbles to the Texts around it. The pointer shows the innermost span's `cursor`. Spans have no box of their own (`measure()` and `onLayout` are the outer Text's).

Add `selectable` to let the user select it (drag, double click for a word, triple click for a line) and copy it with Cmd/Ctrl+C. Put `selectable` on a `<View>` to make all the text inside selectable as one selection, across texts (drag from one paragraph into another; copy joins them by lines, Cmd/Ctrl+A selects all of it). The selection stays inside that view; clicking elsewhere clears it.

```tsx
<Text selectable>{message.body}</Text>
```

## Input

A text field with a caret, selection, undo, copy and paste, and IME. The core does the editing, so typing never waits for your code.

```tsx
const [name, setName] = createSignal("");
<Input value={name()} onChange={setName} onSubmit={save} placeholder="Name" autoFocus />
```

| Prop | |
|---|---|
| `value` / `defaultValue` | Controlled / uncontrolled text |
| `multiline` | Enter adds a line; Ctrl/Cmd+Enter submits |
| `secure` | Password field |
| `maxLength`, `readOnly` | |
| `allow` | The characters typing and pasting may add, checked in the core: `"0-9."` (characters and ranges), `"^<>"` for all but those |
| `onSelect` | The caret or selection moved: `{ start, end }` in UTF-16 units (`start === end` is a caret) |
| `onChange`, `onSubmit`, `onFocus`, `onBlur` | |

Move the caret with `node.setSelection(start, end)` (via `ref`), in UTF-16 units.

## Image

PNG, JPEG, WebP and SVG, from a path or bytes. SVGs can be tinted with `color`.

```tsx
<Image src="logo.svg" style={{ width: 32, height: 32, objectFit: "contain" }} onError={console.error} />
```

## Canvas

For what views can't draw: charts, sparklines, a waveform, a drawing pad. `draw` gets a context and runs again when a signal it reads changes, so a chart follows its data. The core draws the shapes; no pixels pass through JS.

```tsx
<Canvas width={400} height={180} style={{ backgroundColor: "#f8fafc", borderRadius: 8 }} draw={(g) => {
  g.line(20, 160, 380, 160, "#e2e8f0");                         // x0, y0, x1, y1, colour, width = 1
  data().forEach((v, i) => g.roundRect(20 + i * 30, 160 - v, 16, v, 3, "#bfdbfe"));
  g.area(points(), 160, "#2563eb33");
  g.polyline(points(), "#2563eb", 3);
  g.circle(x, y, 5, "#ffffff").strokeCircle(x, y, 5, "#2563eb", 2);
}} />
```

Coordinates are logical px from the canvas's top left; shapes are cut to its box and come out in the order drawn. Available: `fillRect`, `strokeRect`, `roundRect`, `circle`, `strokeCircle`, `line`, `polyline`, and `area(points, baseline, colour)`, the fill between a polyline and a horizontal line (an area chart; points go left to right). Colours are hex (`"#2563eb40"` is see-through) or `[r, g, b, a]`. Shapes with curves go through a `Path`: `moveTo`, `lineTo`, `quadTo`, `curveTo` (cubic), `arc(cx, cy, r, from, to)` (radians, clockwise from the right; `to < from` goes back) and `close()`. Then `g.fill(path, colour)` or `g.stroke(path, colour, width)`; `g.fillPath(points, colour)` fills a polygon directly (even-odd where it crosses itself).

```tsx
// A donut slice: out along the big circle, back along the small one.
g.fill(new Path().arc(75, 75, 65, a, b).arc(75, 75, 38, b, a).close(), "#2563eb");
```

`g.text(string, x, y, colour, size = 14, weight = 400)` draws one line from its top left (it doesn't wrap: put longer text in a `<Text>` over the canvas). Gradients and images in the canvas (use views for those) and a GPU surface for video aren't there yet. A canvas is a view: it takes pointer handlers, so hit-testing shapes is yours to do from the pointer's position.

## Html

A static HTML/CSS document, such as an HTML mail, laid out and drawn by the core like any other node: no browser engine, no scripts, and nothing fetched behind your back. It clips, scrolls inside a `<Scroll>` and can be overlapped like a `<View>`. Its width comes from the layout, and its height follows the document's at that width.

```tsx
<Scroll style={{ flexGrow: 1, minHeight: 0 }}>
  <Html
    html={message.html}
    colorScheme={useColorScheme()()}             // what prefers-color-scheme answers
    loadImage={(url) => parts.get(url) ?? null}  // cid: parts now; remote ones once the reader allows them
    onLink={(url) => openExternal(url)}          // the view never navigates
    style={{ width: "100%" }}
  />
</Scroll>
```

- **Images and stylesheets** the document asks for go to `loadImage(url)`, once per URL. It returns the bytes, a promise of them, or `null` to leave one out (blocked, or not found). Without `loadImage` nothing loads, and `data:` URLs always do. To load what was blocked, make a new `<Html>` (the example does it with `<Show>`).
- **What it handles:** tables (with `bgcolor`, `width` and `cellpadding`), inline and `<style>` CSS with media queries, `<center>` and `<font>`, rounded corners, PNG, JPEG, GIF, WebP and SVG images. It's [Blitz](https://github.com/DioxusLabs/blitz): Stylo for CSS, with the same Taffy and Parley as the rest of the core.
- **Not yet:** text selection, and one-sided cell borders in `border-collapse: collapse` tables.
- `bun run mail` shows an HTML mail with "Load images".

## WebView

Shows a web page in the window, through Bun's `Bun.WebView`: the page is rendered off screen and its frames are drawn as an image, so Mantou content can sit over it. Clicks, the wheel and typing are forwarded to the page.

```tsx
<WebView src="https://example.com" style={{ flexGrow: 1 }} onNavigate={(url, title) => setTitle(title)} />
<WebView html={mail.bodyHtml} style={{ height: 400 }} ref={(page) => (view = page)} />   // page.evaluate, goBack, reload…
```

- **Platforms:** macOS uses WKWebView. Elsewhere Bun needs Chrome installed, so treat it as macOS-only for now.
- **Limits:** it is a picture of the page (about 20 frames a second while something changes, then 2 a second), so there is no native text selection, no text fields' IME, and video is choppy. A native embedded webview is tracked in [#73](https://github.com/dunkbing/mantou/issues/73).

For a real web view add `native`: a child web view of the window (macOS only for now), with native selection, text input and video. It sits above Mantou's own drawing, so nothing can overlap it, and it follows layout changes with a short lag. `onMessage` hears `window.ipc.postMessage(text)` from the page, `nativeRef` gives `run(script)` to evaluate JavaScript in it, and `onError` tells you when native views aren't available. `bun run webview` shows it.

```tsx
<WebView native src="https://example.com" style={{ flexGrow: 1 }} onMessage={(m) => console.log(m)} />
```

## Scroll and List

`<Scroll>` is a scrolling container; the core scrolls it with no JS and draws the scrollbar.

```tsx
<Scroll style={{ flexGrow: 1 }} contentStyle={{ padding: 16, gap: 8 }}>…</Scroll>
```

`<List>` is a virtualized list for thousands of rows: only the visible rows exist.

```tsx
<List each={messages()} itemHeight={56} style={{ flexGrow: 1 }}>
  {(item, i) => <Text>{item().subject}</Text>}
</List>
```

`itemHeight` can be a function for rows of different heights. A `ref` gives `scrollToIndex(i)`.

## Base components

Built on the primitives above, accessible and keyboard-friendly, with a plain default look ([#22](https://github.com/dunkbing/mantou/issues/22)). `bun run gallery` shows them all.

```tsx
import { Button, Checkbox, Combobox, Dialog, Menu, Progress, RadioGroup, Select, Slider, Spinner, Splitter, Table, Tabs, Toast, Toggle, Tooltip } from "mantou-ui";

<Button onPress={save}>Save</Button>                       // variant: "primary" | "secondary" | "ghost"; disabled
<Checkbox checked={news()} onChange={setNews}>Send me news</Checkbox>
<Toggle checked={wifi()} onChange={setWifi}>Wi-Fi</Toggle>  // a switch (Switch is Solid's control flow)
<RadioGroup value={theme()} onChange={setTheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
<Slider value={volume()} onChange={setVolume} min={0} max={100} step={5} />
<Tabs tabs={[{ id: "inbox", label: "Inbox" }, { id: "sent", label: "Sent" }]} value={tab()} onChange={setTab}>{(id) => <Panel id={id} />}</Tabs>
<Dialog open={open()} onClose={() => setOpen(false)} title="Discard the draft?">…</Dialog>
<Tooltip text="Copies the link">…</Tooltip>
<Select value={lang()} onChange={setLang} placeholder="Language" options={[{ value: "en", label: "English" }, { value: "vi", label: "Tiếng Việt" }]} />
<Menu items={[{ id: "rename", label: "Rename" }, { id: "-", label: "", separator: true }, { id: "del", label: "Delete" }]} onSelect={run}>Actions</Menu>  // a popover under its trigger
<Combobox value={city()} onChange={setCity} options={cities} onSelect={go} placeholder="City" />   // suggestions narrow as you type
<Table columns={[{ key: "id", header: "ID", width: 60 }, { key: "name", header: "Name" }]} rows={rows()} sort={sort()} onSort={toggleSort} onRowPress={open} />
<Progress value={done() / total()} />                       // 0 to 1
<Spinner size={20} />                                       // turns while it's on screen
<Toast open={saved()} onClose={() => setSaved(false)}>Saved</Toast>  // closes itself after `duration` (4000 ms)
<Splitter size={width()} onResize={setWidth} min={120} max={400}>{[<Sidebar />, <Main />]}</Splitter>
```

- **State is the app's:** each takes its value and an `onChange` (or `onPress`), and draws what it's given.
- **Keyboard:** they're focusable, with the focus ring when reached by Tab. Enter and Space press buttons and toggle checkboxes and toggles. Tab reaches a radio group or a tab list once (its chosen item), and the arrows move the choice. A slider moves with the arrows, Page Up and Down and Home and End. A focused splitter handle moves with the arrows. A dialog keeps Tab inside it, closes on Escape or a press on its backdrop, and gives the focus back when it closes.
- **Pointer:** hover and pressed looks, a slider you press or drag anywhere on, a splitter handle you drag. A tooltip shows after the pointer rests (`delay`, default 500 ms).
- **Styles:** `style` is laid over the default look. It can be a function of the state: `style={(s) => ({ backgroundColor: s.pressed ? "#000" : s.hovered ? "#333" : "#555" })}`, where `s` has `hovered`, `pressed`, `focused` and `disabled` (and `checked` or `value` where they apply).

Not yet: Select and Combobox (they need native menus, #21), Popover.

## Widget themes

The base components read colour tokens from `theme` and are light by default. `setTheme` changes them all at once (they repaint reactively):

```tsx
import { setTheme, theme, lightTheme, darkTheme } from "mantou-ui";

setTheme("dark");                        // or "light", or "system" (follow the OS)
setTheme({ ...darkTheme, accent: "#10b981" });   // your own tokens (missing ones come from light)

<View style={{ backgroundColor: theme.background }}>
  <Text style={{ color: theme.text }}>Your own views can use the tokens too</Text>
</View>
```

Tokens: `background`, `surface`, `surfaceAlt`, `control`, `controlHover`, `controlPressed`, `selected`, `border`, `borderHover`, `divider`, `track`, `text`, `dimText`, `placeholder`, `accent`, `accentHover`, `accentPressed`, `accentText`, `accentSoft`, `knob`, `inverse` (tooltips, toasts), `inverseText`. A component's `style` prop still wins over the theme. The theme is global to the app; `setColorScheme`/`defineTheme` (see Styling) are separate and unchanged.

## Control flow

`For`, `Index`, `Show`, `Switch` and `Match` work as in Solid; use them instead of `.map` and `?:` so only what changed updates.

```tsx
<For each={todos()}>{(t) => <Item todo={t} />}</For>
<Show when={error()} fallback={<Text>OK</Text>}>{(e) => <Text>{e()}</Text>}</Show>
```

Also exported from Solid: `createSignal`, `createMemo`, `createEffect`, `createRoot`, `batch`, `untrack`, `on`, `onCleanup`, `onMount`.

## Window helpers

- `run(app, { title, width, height, minWidth, minHeight, resizable, fonts })` opens the window.
- `useWindowSize()` is a signal of the window size.
- `onKey(handler)` hears keys anywhere in the window (keys an `Input` uses don't reach it).
