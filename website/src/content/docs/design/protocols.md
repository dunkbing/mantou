---
title: "Protocols"
description: "The op stream, event records, text input, styles and text handling between the Worker and the core."
---

## 8. Protocols

### 8.1 Ops (Worker → core)

One `ArrayBuffer` per commit. It holds a header, a section of newly interned strings, and the op stream as 32-bit words. `f32` values are written through a `Float32Array` view over the same buffer.

```
header:   magic u32 · version u16 · flags u16 · opCount u32 · stringsBytes u32
strings:  repeated { id u32 · byteLen u32 · utf8 bytes (padded to 4) }   // new interned strings only
ops:      repeated { opcode u16 · wordCount u16 · words… }
```

**Status:** the op stream is implemented as above, with each op's first word `code | operandWords << 16`. The header and the string section aren't yet: `TITLE` carries its string inline, and nothing else needs strings until there is text. The source of truth is [`schema/protocol.ts`](https://github.com/dunkbing/mantou/blob/main/schema/protocol.ts); `bun run gen` generates the TypeScript and Rust bindings from it, and CI fails when they're stale. The ops implemented so far are `CREATE` (kind `View` only), `INSERT`, `REMOVE`, `RELEASE`, `STYLE`, `STYLE_RESET`, `STYLE_DEF`, `STYLE_USE`, `LISTEN`, plus three window ops, `SET_ROOT`, `CLEAR_COLOR` and `TITLE`.

| Op | Operands | Meaning |
|---|---|---|
| `CREATE` | id, kind | New node (`View`, `Text`, `Span`, `Scroll`, `Image`, `Input`, `List`, `Window`…) |
| `TEXT` | id, strId | Text content of a text leaf or span |
| `INSERT` | parent, child, before (0 = append) | Insert, or move if the child is already attached |
| `REMOVE` | parent, child | Detach only |
| `RELEASE` | id | Free the node and its resources |
| `STYLE` | id, prop, value… | Set one style property (typed value; see below) |
| `STYLE_RESET` | id, prop | Back to the default |
| `PROP` | id, prop, value… | Non-style props: `src`, `placeholder`, `role`, `label`, `value`+`rev`, `disabled`… |
| `LISTEN` | id, eventMask | Which events this node has handlers for |
| `STYLE_DEF` | styleId, (prop, value…)* | Define a shared style ([§8.4](/design/protocols/#84-styles)) |
| `STYLE_USE` | id, styleId (0 = none) | Apply a shared style; per-node `STYLE` ops override it |
| `COMMAND` | id, cmd, reqId, args… | `focus`, `blur`, `scrollTo`, `measure`, `animate`, `select`… |

**Value encodings:**
- `f32` (number)
- `u32` (enum)
- `color` (RGBA8 packed into a u32; wide gamut later)
- `length` (f32 + a unit: px, %, auto)
- `strId`
- short lists: a count followed by the items

Style and prop ids, and their types, are **generated from one schema** shared by the Rust decoder and the TS encoder and typings, so the two sides can't drift apart.

### 8.2 Events (core → Worker)
- The main thread appends event records to a buffer guarded by a mutex. It sets an atomic `wake_pending` flag, and only if that flag was clear does it call the threadsafe `wake` callback. That coalesces bursts into one wake.
- On wake, the Worker calls `mt_take_events()`, which swaps the buffers and clears the flag. It then dispatches every record. Any ops the handlers produce flush in the same turn's microtask.
- Record format: `type u16 · size u16 · target u32 · time f64 · payload…`

| Event | Payload |
|---|---|
| `PRESS`, `LONG_PRESS` | position; the core synthesises these from the pointer, keys and accessibility actions |
| `POINTER_DOWN/MOVE/UP/ENTER/LEAVE` | position, buttons, modifiers. Sent only to nodes listening for them |
| `KEY_DOWN/UP` | key, code, modifiers, repeat |
| `TEXT_CHANGE` | value strId, selection, `rev` |
| `FOCUS`, `BLUR` | — |
| `SCROLL` | offset (throttled; only if listened for) |
| `LAYOUT` | rect. For `onLayout` listeners and `measure` replies (`reqId`) |
| `WINDOW` | resized, moved, close-requested, focus changed, scale changed |
| `MENU`, `A11Y_ACTION`, `FILE_DROP`, `COMMAND_RESULT` | … |

**Propagation:** the core hit-tests and sends the target, plus the path of ancestors that have listeners. JS runs the capture and bubble phases. `stopPropagation` happens in JS.
**No synchronous `preventDefault`:** input is asynchronous, so the core's default actions (focus on press, scroll on wheel, editing keys) are controlled by props (`focusable`, `scrollEnabled`, `onKeyDown` with declared `keys` it consumes). This is a deliberate API constraint.

### 8.3 Text input
- **The core owns editing:** caret, selection, IME composition, undo, clipboard and word movement, so typing never waits for JS.
- **Decided (Q2): two modes, like the DOM. Typing never waits for JS in either.**
  - `defaultValue` makes the input **uncontrolled**: the core holds the text, and `onChange` reports it.
  - `value` + `onChange` makes it **controlled**: the core applies keystrokes at once and reports `TEXT_CHANGE(value, rev)`. The `value` prop JS sends back carries the `rev` it answers, and the core ignores values whose `rev` is stale. A `value` that differs from what the user typed (uppercasing, say) replaces the text, and the caret is kept by its offset from the end.
- **Constraints are declarative, not synchronous filters:** `maxLength`, `allow` (a regex over characters, checked natively), `inputMode`, `autoCapitalize`, `secure`. These cover what `beforeinput` filtering is usually for, without a synchronous round trip through JS.

### 8.4 Styles
- **Decided (Q4): v1 uses typed style objects only** (`style={{…}}`). They cover flexbox and grid (Taffy), box properties (background, border with per-side widths, radii, shadow, opacity, transform, overflow/clip) and text (font family, size, weight, line height, color, alignment, decoration). TypeScript checks every property.
- **Shared styles on the wire from day one:**
  - The JSX plugin hoists static style objects. The runtime sends each one once as `STYLE_DEF(styleId, props…)`, and nodes reference it with `STYLE_USE(id, styleId)`.
  - Dynamic values still go through per-property `STYLE` ops, and they override the shared style.
  - A list of 1,000 rows sharing one style therefore costs one definition plus 1,000 four-byte references.
- **Later (once the base components settle):** an optional build-time Tailwind subset that compiles `class="…"` into the same `STYLE_DEF`s, so the core never parses classes. It's worth adding for AI-generated UI, as NSH found, but not before theming and the base components settle.
- Units are logical pixels. The core rounds layout to device pixels at the window's scale factor.

### 8.5 Text
- parley lays text out on the Worker thread, inside `mt_commit` during layout. Measurements are cached by a hash of the layout-relevant content plus the width constraint; colour is excluded, so a colour change never triggers layout.
- swash rasterizes glyphs into a coverage atlas and a colour atlas. Following MyGo, a glyph seen for the first time goes into a transient zone and moves to a lasting one once drawn again. If an atlas fills mid-frame, the core makes room and repaints rather than showing missing glyphs.
- **Decided (Q5): parley on every platform in v1, behind a `TextEngine` trait** (as NSH has).
  - **Why:** one implementation to build and debug. Layout is also identical on every OS when the fonts are the same: tests bundle a test font, so headless text and image snapshots taken on Linux CI hold everywhere.
  - **Cost:** text won't match each OS's own toolkit pixel for pixel, as MyGo's system text stacks do.
  - **Checkpoint once text renders:** compare screenshots of parley text against native labels on each OS. If the difference is noticeable, add a Core Text backend first, since Mac users notice text rendering most. The trait keeps that change local to `mantou-text`.
