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

**Status:** the op stream is implemented as above, with each op's first word `code | operandWords << 16`. The header and the string section aren't yet: strings travel inline, as a byte length and then the UTF-8 bytes padded to words. The source of truth is [`schema/protocol.ts`](https://github.com/dunkbing/mantou/blob/main/schema/protocol.ts); `bun run gen` generates the TypeScript and Rust bindings from it, and CI fails when they're stale. The ops implemented so far:
- **Tree:** `CREATE` (kinds `View`, `Text`, `Input` and `Image`), `INSERT`, `REMOVE`, `RELEASE`, `STYLE`, `STYLE_RESET`, `STYLE_DEF`, `STYLE_USE`, `LISTEN`.
- **Content:** `TEXT` (a Text node's content), and for inputs `VALUE` (id, rev, text), `PLACEHOLDER`, `INPUT_OPTIONS` (flags: multiline, secure, read-only; the maximum length), `SELECT` (anchor and caret in UTF-16 units), `FOCUS` (0 blurs) and `FOCUS_SCOPE` (trap Tab inside a view, restore the focus when it goes); for scroll views `SCROLL_TO` (an offset, or by one) and `SCROLL_INTO_VIEW` (with a block position), applied after the batch's layout; for images `IMAGE_PATH` and `IMAGE_DATA`; app fonts `FONT` (the file's bytes) and `FONT_FAMILY` (an id for a `fontFamily` list); in place of the `PROP` and `COMMAND` ops below.
- **Animation:** `TRANSITION` (id, prop, duration, easing) and `ANIMATE` (id, animation, prop, from, to, duration, easing, iterations, flags), run by the core ([Animations](/progress/animations/)).
- **Window:** `SET_ROOT`, `CLEAR_COLOR`, `TITLE`, `WINDOW_SIZE`, `WINDOW_LIMITS`.

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
- **Status:** records are `[head, a, b, c]` as u32 words (floats as bits) and then `head >> 16` more words; `head & 0xffff` is the type. `TEXT_CHANGED` has more words (its text), and so does `LAYOUT` (a node's box: x and y in `b` and `c`, then width and height). `mt_take_events` copies whole records and returns 0 when none are left, or `0x80000000 | size` when the next record doesn't fit, and the runtime grows its buffer. Implemented: `WINDOW_READY`, `RESIZED` (with the scale, so the runtime gives logical sizes), `SCALE_CHANGED`, `CLOSE_REQUESTED`, `POINTER_DOWN/MOVE/UP`, `KEY_DOWN/UP` (with modifiers), `PRESS`, `WHEEL`, `FOCUS`, `BLUR`, `TEXT_CHANGED`, `SUBMIT`, `LAYOUT` `SCROLL` (a scroll view's offset, to views with the `Scroll` listener bit), `SERVICE_RESULT` (the answer to a platform service request, [Menus and native dialogs](/progress/platform-services/)) `MENU` (a chosen app-menu item) and `CORE_ERROR` (a panic the core recovered from, [Errors and crash reports](/progress/crash-reports/)). `LAYOUT` goes to nodes with the `Layout` listener bit after any layout that changes their box, including the main thread's layouts on resize, and once to a new listener; `onLayout` and `node.layout` in the runtime read it, and `useWindowSize()` follows `WINDOW_READY` and `RESIZED`.

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
- **Status:** implemented as `<Input>` ([Text input](/progress/text-input/)), with `maxLength` and `readOnly` of the constraints. The editor is parley's `PlainEditor` with Mantou's undo, limits and scrolling (`mantou-text/src/editor.rs`); focus, keys, the pointer and the IME are in `mantou-tree`, and the clipboard is the FFI crate's. A controlled value that replaces the user's text keeps the caret at its byte offset, clamped, rather than its offset from the end. The keys the focused input uses aren't sent to JS at all, which settles the `onKeyDown` question of [§8.2](/design/protocols/#82-events-core--worker) for inputs.

### 8.4 Styles
- **Decided (Q4): v1 uses typed style objects only** (`style={{…}}`). They cover flexbox and grid (Taffy), box properties (background, border with per-side widths, radii, shadow, opacity, transform, overflow/clip) and text (font family, size, weight, line height, color, alignment, decoration). TypeScript checks every property.
- **Shared styles on the wire from day one:**
  - The JSX plugin hoists static style objects. The runtime sends each one once as `STYLE_DEF(styleId, props…)`, and nodes reference it with `STYLE_USE(id, styleId)`.
  - Dynamic values still go through per-property `STYLE` ops, and they override the shared style.
  - A list of 1,000 rows sharing one style therefore costs one definition plus 1,000 four-byte references.
- **Later (once the base components settle):** an optional build-time Tailwind subset that compiles `class="…"` into the same `STYLE_DEF`s, so the core never parses classes. It's worth adding for AI-generated UI, but not before theming and the base components settle.
- Units are logical pixels. The core rounds layout to device pixels at the window's scale factor.

### 8.5 Text
- parley lays text out on the Worker thread, inside `mt_commit` during layout. Measurements are cached by a hash of the layout-relevant content plus the width constraint; colour is excluded, so a colour change never triggers layout.
- swash rasterizes glyphs into a coverage atlas and a colour atlas. A glyph seen for the first time goes into a transient zone and moves to a lasting one once drawn again. If an atlas fills mid-frame, the core makes room and repaints rather than showing missing glyphs.
- **Status:** implemented in `mantou-text`. The bundled font is Inter (Regular, Medium, SemiBold, Bold; OFL), with the system's fonts as the fallback. Layouts are cached by text, style and width (two generations of 4,096, so a larger working set keeps most of its hits), each Text node keeps the layout it was last drawn with, text entirely outside its clip isn't laid out, and an unchanged tree builds no new scene ([#9](https://github.com/dunkbing/mantou/issues/9); counted by the `textLayouts` and `scenes` stats). The parley font context is built once per process; apps add fonts to an instance with `FONT` and pick them with `fontFamily` (a `FONT_FAMILY` id, so the style stays one word). Glyphs are rasterized at device size with four horizontal subpixel positions into one coverage atlas, so colour emoji draw as monochrome shapes for now. `maxLines` cuts off with an ellipsis. Text styles aren't inherited yet, and a `<Text>` has one style (no spans).
- **Decided (Q5): parley on every platform in v1, behind a `TextEngine` trait**.
  - **Why:** one implementation to build and debug. Layout is also identical on every OS when the fonts are the same: tests bundle a test font, so headless text and image snapshots taken on Linux CI hold everywhere.
  - **Cost:** text won't match each OS's own toolkit pixel for pixel, as a system text stack would.
  - **Checkpoint once text renders:** compare screenshots of parley text against native labels on each OS. If the difference is noticeable, add a Core Text backend first, since Mac users notice text rendering most. The trait keeps that change local to `mantou-text`.
