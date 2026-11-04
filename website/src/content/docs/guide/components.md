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

Other props: `transition` (animate style changes, see [styling](/guide/styling/#animation)), `focusScope` (keep Tab inside a dialog), `ref`, and the [accessibility props](/guide/platform/#accessibility).

## Text

Text is only drawn inside `<Text>`, whose children are strings and numbers.

```tsx
<Text style={{ fontSize: 14, color: "#374151", maxLines: 2 }}>Hello, {name()}</Text>
```

Add `selectable` to let the user select it (drag, double click for a word, triple click for a line) and copy it with Cmd/Ctrl+C. One text at a time; clicking elsewhere clears it.

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
