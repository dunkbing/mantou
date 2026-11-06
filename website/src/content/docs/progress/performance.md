---
title: Performance
description: "The benchmark suite (bun run bench): what it measures, the first results, and what they point at."
---

`bun run bench` runs the scenarios in `bench/`. Each runs headless on the real core, in a fresh process, three times, and the median of each metric is kept. It prints a table, and `--json out.json` saves it, so `--compare out.json` can show the change from an earlier run on the same machine. CI runs it on every push and shows the table in the job's summary; timings vary between runners, so it never fails the build.

The core counts where its time goes. Next to its counters, `stats()` has `applyMicros`, `layoutMicros`, `sceneMicros` and `renderMicros`: the time spent applying op batches, laying out, building scenes and drawing.

| Scenario | What it does |
|---|---|
| `startup` | From the process starting to the counter's first frame laid out, then drawn. |
| `cells-animated` | 3,000 cells animated by the core (opacity and a colour, forever), as in BUI's benchmark: a frame's cost with no JS. |
| `cells-js` | 3,000 cells recoloured from JS every frame (one signal): effects, encoding, one commit, layout, scene. |
| `list-scroll` | A 10,000-row `<List>` scrolled by the wheel. |
| `typing` | Typing into a multiline `<Input>` holding 5,000 characters. |
| `text-layout` | 1,000 paragraphs: the first layout, then relayouts at new widths, as when resizing. |
| `html` | An HTML mail in `<Html>`: the first frame, scrolling through it, and dragging a selection. |
| `memory` | Memory at rest and after the first frame, per view and per `<Text>`, a 10,000-row `<List>`, an HTML mail, and what mounting and disposing a UI over and over leaves behind. |

Every scenario also reports the process's memory when it ends (`rss at the end`, `JS heap at the end`).

## First results

On the CI-like container these pages were written on (an Intel Xeon at 2.1 GHz, no GPU: Mesa's llvmpipe), Bun 1.4.4, median of 3 runs:

| | |
|---|--:|
| Process start to the first frame drawn | 494 ms; **145 ms** with compiled JSX cached |
| … of which Bun and the JSX plugin (Babel) | 228 ms; **34 ms** |
| … importing `mantou-ui` | 167 ms; **8 ms** |
| 3,000 animated cells, a frame (CPU) | 2.5 ms (scene 0.8 ms) |
| 3,000 cells recoloured from JS, a frame | 9.3 ms (JS 5.7, layout 2.2, applying 0.8, scene 0.5); **7.6 ms** (layout 0.7) since colours stopped laying out |
| 10,000-row list, a wheel step | 0.7 ms |
| Typing in 5,000 characters, a key | 9.0 ms (layout 5.1, scene 2.2); **2.3 ms** since the fix below |
| 1,000 paragraphs: first layout / relayout at a new width | 46 ms / 3.6 ms; **1.5 ms** a relayout since shaped text is kept |
| HTML mail: first frame / a selection drag step | 57 ms / 10 ms; **0.03 ms** a drag step |

What they point at, roughly in order of what users would notice:

- **Typing in a long text** laid the whole text out three times a key: 9 ms at 5,000 characters. Fixed: the editor's wrap width was set again on every frame and on every measure, and each time parley laid the text out again; an input stretched across a column was first measured at the default width (200 px) and then laid out at its own. Now a key lays the text out once, and only the lines that show are drawn: 2.3 ms (layout 0.01, scene 0.5), the rest being that one layout of the edited text. (The stretched input's height is now right too: it was its text's height at 200 px.) Laying out only the edited paragraph would take the rest.
- **Dragging a selection in an Html document** repainted the bands that show, on the CPU: 10 ms a step. Fixed: the bands are painted without the selection, and its highlight is drawn over them on the GPU (one translucent rectangle per line, the inputs' selection colour), so a drag step repaints nothing: 0.03 ms. Scrolling to a new band still paints it (6 ms).
- **Startup** spent 167 ms importing `mantou-ui` before any window existed, and 228 ms before that loading Bun and the JSX plugin. Nearly all of it was Babel: 200 ms and 40 MB to load it, and 250 ms to compile the widgets. Fixed: compiled files are kept in the user's cache folder, keyed by their source and the compiler's versions, and Babel loads only when a file is new or changed. From the cache, the counter's first frame is laid out 62 ms after the process starts and drawn at 145 ms (most of that is llvmpipe). A packaged app, compiled ahead of time, no longer loads Babel at all.
- **A big JS update** spends most of its time in JS (5.7 of 9.3 ms for 3,000 style changes). It also laid out again for colours, which move nothing: fixed, a style change now lays out only when the node's layout style or text style changed, and otherwise only places the boxes again (layout 2.3 to 0.7 ms a frame).
- **Per-frame overheads**, found by reading the frame path rather than by one benchmark, and fixed together:
  - A new width shaped every text again. Shaped text is now kept apart from its line breaks, so a resize only breaks lines again (an exact match for a fresh layout, tested): a relayout at a new width went from 3.7 to 1.5 ms. Layouts are looked up by a fast hash, without copying the text.
  - A new glyph copied the whole atlas (the last scene still held it, so adding to it copied it first) and then uploaded all of it, up to 16 MB. The atlas is now shared and only grows, and a renderer uploads only the rows that changed since its last upload.
  - Instances were copied into a byte vector, and a map of bind groups was built, every frame; now the buffer is uploaded as it is and the bind groups are borrowed.
  - Nodes are looked up by a fast hash; each box's opacity reads its parent's instead of walking to the root; placing boxes doesn't copy each node's children.
  - With nothing that uses hover (a listener, a cursor, an input, an Html node, spans), a still pointer isn't hit-tested again each time the boxes move (a scroll, an animation).
  - Together: 3,000 cells recoloured from JS, layout 0.7 to 0.34 ms and scene 0.62 to 0.48 ms a frame; the counter's first frame drawn 140 to 120 ms.

Not measured yet: frames in a real window (presenting, vsync, input to photon), and a GPU's draw time (`draw + read back` here is llvmpipe on the CPU).

## Memory

Measured after a full garbage collection, same machine, median of 3 runs. "Native" is the resident set less the JS heap: Bun, the core, and the GPU driver (llvmpipe here, which is on the CPU; a GPU's driver keeps less in the process).

| | |
|--:|--:|
| Bun and the JSX plugin (Babel) | 70 MB; **28 MB** with compiled JSX cached (no Babel) |
| … with `mantou-ui` imported | 96 MB; **31 MB** |
| … an empty instance | 102 MB; **38 MB** |
| … after the first frame drawn (GPU device and pipelines) | 180 MB; **128 MB** |
| A view | 4.6 KB native + 3.5 KB JS; **2.2 KB JS** since handlers are made when first used |
| A `<Text>` (its shaped text kept) | 12 KB native + 3.5 KB JS; **2.2 KB JS** since |
| A 10,000-row `<List>` | 0.1 MB (only the rows that show exist) |
| An HTML mail in `<Html>` | 10 MB |
| Mounting and disposing 3,000 nodes, 50 times | 0 core nodes left; about 4 JS objects left per mount, whatever its size |

Leaks are counted in objects and nodes, not in the resident set: the allocators keep memory they've freed, so it moves up and down (it settled near 160 MB over 400 rounds of mounting and disposing 3,000 nodes, while the JS heap stayed at 15 MB). The core's tree alone, mounting and disposing the same nodes 400 times, stays at exactly the same size.

What it points at:

- **A JS `Node` costs 3.5 KB**, because it creates about 25 objects up front: a map of its styles and one of its transitions, a set of running animations, and an empty array for each kind of handler (press, wheel, layout, scroll, hover, five pointer kinds, drop, image), whether it uses them or not. Fixed: they're made when first used (and an input's options, and the scroll offset, start shared), so a node costs 2.2 KB. Most of the rest is Solid's own per-element work and the node's map of styles.
- **Importing `mantou-ui` cost 26 MB**, and Babel 40 MB before it: both were Babel loading and compiling. Fixed with the cache above: 31 MB with `mantou-ui` imported, where it was 96.
- The benchmark found a crash on the way: disposing an app with a scroll view in it left the scroll view's thumb in the next scene, and drawing it panicked. Fixed, with a test.
