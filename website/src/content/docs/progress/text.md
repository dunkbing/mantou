---
title: Text and Mantou Mail
description: Text rendering, rounded corners, borders, clipping, keys and the wheel, and Mantou Mail, an email app built with them.
---

![Mantou Mail: a sidebar of mailboxes and labels, the message list, and the reader with quick replies](../../../assets/mail.png)

## Mantou Mail

[Mantou Mail](https://github.com/dunkbing/mantou-mail) is a mail client built only with what Mantou can do today, on sample data. It started in this repo and now lives in its own, where it uses Mantou the way any app does, as the `mantou-ui` package:
- **Sidebar:** all inboxes, each account, starred, snoozed, sent, archive and trash, plus labels, with unread counts.
- **Message list:** Important and Other tabs, and rows with an avatar, sender, time, subject, preview, unread dot, star and chips ("Waiting for reply", "Snoozed until", labels).
- **Reader:** the message, its labels, and quick replies (sending adds the reply to Sent).
- **Toolbar and status bar:** Archive, Reply, Older, Newer, Delete, and the last action with undo.
- **Keyboard:** `j`/`k` move, `e` archives, `#` deletes, `s` stars, `u` toggles unread, `r` opens quick replies (then `1`–`3` sends one), `z` undoes, `1`/`2` switch tabs.
- **Scrolling:** the wheel scrolls the list and the reader; the selected row is kept in view.

It runs in a window, where its first frame appears about 0.7 s after launch on Linux (mostly Babel compiling the app's JSX), and on headless instances: its tests cover opening, keyboard triage and undo, tabs, the wheel, quick replies, the sidebar and captured pixels.

It was built before Mantou had [text input](/progress/text-input/), so it has no compose window or search yet.

## What the framework gained

| | |
|---|---|
| **Text** | `<Text>` with `color`, `fontSize`, `fontWeight`, `lineHeight`, `textAlign`, `fontStyle` and `maxLines` (with an ellipsis). Laid out in the core with parley, measured by Taffy, rasterized with swash into a glyph atlas ([§8.5](/design/protocols/#85-text)) |
| **Boxes** | `borderRadius`, `borderWidth`, `borderColor`: an SDF in the quad shader. Borders inset the content, as CSS's `border-box` |
| **Clipping** | `overflow: "hidden"` clips descendants, intersected down the tree; hit-testing ignores what's clipped away |
| **Input** | Keys with modifiers and named keys (`onKey`), the wheel (`onWheel`, bubbling like presses) |
| **Measuring** | `node.measure()`: where the core laid a node out, after committing the changes made so far. Since then also `onLayout` on any element (its box after the first layout and whenever it changes, window resizes included) and `useWindowSize()` |
| **Headless** | `HeadlessCore.key()` and `.wheel()`, and a `glyphs` counter |

![The counter, with labels and the count as text](../../../assets/counter.png)

## Tests

- **Text engine** (`mantou-text`): wrapping, the ellipsis, centred lines, weights, the layout cache, rasterization and atlas growth.
- **Tree** (`tests/text.rs`): text measured and wrapped, glyph quads, ellipsis inside the box, clipping, borders insetting content, a clipping box smaller than its content, text that keeps its logical layout across scale factors.
- **Incremental vs from scratch:** the random-change model now has text nodes, text changes and every text and box property. After each frame the incremental tree still equals one rebuilt from scratch, boxes to the bit.
- **Fuzzing:** the same three targets, with text in the `layout` target.
- **Headless and window:** the counter's labels and count, keys, and Mantou Mail.

## Findings

- **Flexbox minimum sizes apply.** A flex item is at least as tall as its content unless it clips, which matches CSS. A scrolling list in a fixed-height window needs `minHeight: 0` on the flex containers around it, as in CSS. Mantou had to tell Taffy about `overflow: hidden` as well as clip, so a clipping box can be smaller than its content.
- **`flexShrink` defaults to 1**, as in CSS, so fixed-size parts (sidebars, avatars) need `flexShrink: 0`.
- **Fonts once per process.** Building a font context per tree (system font scan plus Inter) made the layout property test 35× slower. The context is now built once and cloned, and each tree creates its text engine only when its first text node appears.
- **Comparing scenes:** atlas positions depend on the order glyphs were first drawn, so trees are compared on everything else (a glyph's size, place, colour and clip).
- **fontconfig keeps memory from its one-time setup**, which LeakSanitizer reports when fuzzing. `core/fuzz/lsan.supp` suppresses it.

## Text cost in big trees

Reported from Mantou Mail with 2,000 messages ([#9](https://github.com/dunkbing/mantou/issues/9)): every scene laid out every Text node, visible or not, and past 4,096 distinct texts the layout cache was cleared on every frame. Now text entirely outside its clip isn't laid out, each Text node reuses the layout it was last drawn with, the cache keeps two generations, and an unchanged tree builds no scene. `tests/text-cost.test.tsx` counts it (`textLayouts`, `scenes`): ten 40 px scrolls of a 4,200-row list lay out at most 20 texts, a label change outside it at most 2, and an idle step builds no scene.

For information (Linux, headless, this machine; not part of the tests), per commit:

| rows | scroll 40 px (negative margin) | change one label | step, nothing pending |
|---:|---:|---:|---:|
| 3,000 | 6.3 ms | 3.1 ms | 0 ms |
| 4,200 | 10.4 ms | 5.6 ms | 0 ms |
| 8,000 | 22.6 ms | 11.6 ms | 0 ms |

The issue measured 208 ms, 212 ms and 98 ms at 4,200 rows before. What remains grows with the list because a negative margin re-lays it out; a `<Scroll>` ([Scrolling and dialogs](/progress/scrolling/)) scrolls without a relayout.

## Rich text

`<Text>` inside `<Text>` is a span ([#15](https://github.com/dunkbing/mantou/issues/15)): bold names, highlighted search matches, links. The outer Text sends its whole text in one `TEXT` op, and `TEXT_RUNS` splits it into runs, each naming the spans it's in, outermost first. A span is a Text node the core knows (its style, its listeners) but never inserts into the layout. The core sets each run in the Text's style with its spans' text properties over it (weight, italic, size, family, letter spacing, decoration), through parley's ranged styles, and draws its colour and highlight (`backgroundColor`). Only what changes the layout is in the layout cache's key, so recolouring a span lays nothing out. A press or the cursor over a run goes to its innermost span. In JS the press then bubbles through the spans around it to the Text.

Op counts: changing a span's text is one `TEXT` and one `TEXT_RUNS` on the outer Text; restyling a span is its own `STYLE` op, and the core redraws its Text.

Found on the way:
- **Italics weren't drawn slanted.** The bundled Inter has no italic face, and nothing synthesized one. Glyphs now carry parley's synthesis (a slant, and emboldening for a missing weight), and the atlas caches them by it, so `fontStyle: "italic"` slants with any font.
- **Decorations at 2×.** Underlines and strike-throughs were scaled by the display scale twice, which put them off the text on HiDPI screens. They're placed in device pixels once now.

Tests: `mantou-text` (spans' glyphs, runs and decorations, the span at a point, transforms that change lengths, colours not in the cache key), `tests/rich.rs` (styles, highlights, presses and cursors on spans, nesting, recolouring with no new layout, bad runs and released spans), `runtime/rich.test.tsx` (op counts), `tests/rich.test.tsx` (a link that presses and bubbles, a bold span's width, and reference images at 1× and 2×).

**Not yet:** selecting inside rich text uses the outer Text's style for the highlight's geometry, so a selection over a bigger or bolder span is slightly off; hover events on spans (the cursor works); inline images and views.

## Emoji and other scripts

[#16](https://github.com/dunkbing/mantou/issues/16).
- **Colour emoji.** They keep their own colours. The core rasterizes colour glyphs into an RGBA atlas of their own, beside the coverage atlas. It draws them as image quads that sample it, so only the text's opacity applies, not its colour. The atlas's texture is made again only when a new emoji is added.
- **Fallback.** Inter comes first, then the platform's colour emoji font (CSS's `emoji` generic: Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji), then the system's fonts. Before, a system font with plain outlines for some emoji (DejaVu on Linux) won, and emoji drew as black shapes. App font families get the same stack after their own fonts.
- **Emoji presentation.** A character followed by U+FE0F (❤️, not ❤) is set without Inter, which has plain glyphs for some symbols, so the emoji font draws it.
- **Sequences.** Skin tones, ZWJ sequences (👩‍💻), flags and keycaps shape to one glyph through the font's own rules (parley and HarfRust).
- **Right to left.** Hebrew and Arabic come out right to left, Arabic letters join, and numbers inside them stay in order (the Unicode bidi algorithm, in parley). A right-to-left paragraph starts at the right. `textAlign: "start"` and `"end"` follow the paragraph's direction, as in CSS. Inputs edit such text in logical order.
- **Other scripts.** Vietnamese, decomposed accents (`e` + U+0301), Greek and Cyrillic are in Inter. Scripts Inter lacks fall back to the system's fonts.

Tests use two bundled fonts so the reference images are the same everywhere (`tests/fonts`). *Mantou Test Emoji* is a 48 KB subset of Noto Color Emoji (OFL). *Mantou Test Scripts* is Latin, Hebrew and Arabic from DejaVu Sans, renamed as its licence asks.
- `mantou-text`: each kind of emoji is one colour glyph, drawn at the size asked.
- `tests/scripts.test.tsx`: emoji are image quads beside glyphs in the text colour; mixed-direction lines; typing Hebrew in an input; reference images at 1× and 2×.

**Not yet:** COLRv1 emoji fonts (swash draws COLRv0 and bitmap ones, which is what the platforms ship); vertical text; a bundled CJK font (it falls back to the system's).

## App fonts

Apps bring their own fonts: icon fonts, brand fonts, monospace for code ([#8](https://github.com/dunkbing/mantou/issues/8), [#14](https://github.com/dunkbing/mantou/issues/14)).

```tsx
run(() => <App />, { fonts: ["./fonts/Lucide.ttf"] }); // or ui.registerFont(bytes) at any time

<Text style={{ fontFamily: "lucide", fontSize: 16, color: muted }}>{ICONS.archive}</Text>
<Input style={{ fontFamily: ["JetBrains Mono", "monospace"] }} />
```

- `fontFamily` takes a family name or a list, tried in order, then Inter and the system's fonts, so a glyph a font lacks still draws. The name is the one in the font file (`fc-scan`, Font Book or the font's docs show it).
- Fonts are registered with one instance's core (a TTF, an OTF or a collection, as bytes), and text laid out before is laid out again, in case the new font changes its fallback.
- On the wire a family list is sent once (`FONT_FAMILY`, an id), and styles refer to the id, like shared styles.
- Tested with a monospace test font (`tests/fonts/`, an ASCII subset of Liberation Mono under the OFL): `core/crates/mantou-tree/tests/fonts.rs` and `tests/fonts.test.tsx`, with a reference image.

