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
| Process start to the first frame drawn | 494 ms |
| … of which Bun and the JSX plugin (Babel) | 228 ms |
| … importing `mantou-ui` | 167 ms |
| 3,000 animated cells, a frame (CPU) | 2.5 ms (scene 0.8 ms) |
| 3,000 cells recoloured from JS, a frame | 9.3 ms (JS 5.7, layout 2.2, applying 0.8, scene 0.5); **7.6 ms** (layout 0.7) since colours stopped laying out |
| 10,000-row list, a wheel step | 0.7 ms |
| Typing in 5,000 characters, a key | 9.0 ms (layout 5.1, scene 2.2); **2.3 ms** since the fix below |
| 1,000 paragraphs: first layout / relayout at a new width | 46 ms / 3.6 ms |
| HTML mail: first frame / a selection drag step | 57 ms / 10 ms |

What they point at, roughly in order of what users would notice:

- **Typing in a long text** laid the whole text out three times a key: 9 ms at 5,000 characters. Fixed: the editor's wrap width was set again on every frame and on every measure, and each time parley laid the text out again; an input stretched across a column was first measured at the default width (200 px) and then laid out at its own. Now a key lays the text out once, and only the lines that show are drawn: 2.3 ms (layout 0.01, scene 0.5), the rest being that one layout of the edited text. (The stretched input's height is now right too: it was its text's height at 200 px.) Laying out only the edited paragraph would take the rest.
- **Dragging a selection in an Html document** repaints the bands that show, on the CPU: 10 ms a step. Painting documents on the GPU would fix this, and scrolling to a new band (6 ms) too.
- **Startup** spends 167 ms importing `mantou-ui` before any window exists. A packaged app skips the Babel part, but not the import; it's worth profiling what loads. Ahead-of-time compilation (blocked on Bun's MDWE issue) cut this by more than half in an earlier trial.
- **A big JS update** spends most of its time in JS (5.7 of 9.3 ms for 3,000 style changes). It also laid out again for colours, which move nothing: fixed, a style change now lays out only when the node's layout style or text style changed, and otherwise only places the boxes again (layout 2.3 to 0.7 ms a frame).

Not measured yet: frames in a real window (presenting, vsync, input to photon), and a GPU's draw time (`draw + read back` here is llvmpipe on the CPU).

## Memory

Measured after a full garbage collection, same machine, median of 3 runs. "Native" is the resident set less the JS heap: Bun, the core, and the GPU driver (llvmpipe here, which is on the CPU; a GPU's driver keeps less in the process).

| | |
|--:|--:|
| Bun and the JSX plugin (Babel) | 70 MB |
| … with `mantou-ui` imported | 96 MB |
| … an empty instance | 102 MB |
| … after the first frame drawn (GPU device and pipelines) | 180 MB |
| A view | 4.6 KB native + 3.5 KB JS; **2.2 KB JS** since handlers are made when first used |
| A `<Text>` (its shaped text kept) | 12 KB native + 3.5 KB JS; **2.2 KB JS** since |
| A 10,000-row `<List>` | 0.1 MB (only the rows that show exist) |
| An HTML mail in `<Html>` | 10 MB |
| Mounting and disposing 3,000 nodes, 50 times | 0 core nodes left; about 4 JS objects left per mount, whatever its size |

Leaks are counted in objects and nodes, not in the resident set: the allocators keep memory they've freed, so it moves up and down (it settled near 160 MB over 400 rounds of mounting and disposing 3,000 nodes, while the JS heap stayed at 15 MB). The core's tree alone, mounting and disposing the same nodes 400 times, stays at exactly the same size.

What it points at:

- **A JS `Node` costs 3.5 KB**, because it creates about 25 objects up front: a map of its styles and one of its transitions, a set of running animations, and an empty array for each kind of handler (press, wheel, layout, scroll, hover, five pointer kinds, drop, image), whether it uses them or not. Fixed: they're made when first used (and an input's options, and the scroll offset, start shared), so a node costs 2.2 KB. Most of the rest is Solid's own per-element work and the node's map of styles.
- **Importing `mantou-ui` costs 26 MB** (and most of the startup time above): worth seeing which modules it loads that an app may not need.
- The benchmark found a crash on the way: disposing an app with a scroll view in it left the scroll view's thumb in the next scene, and drawing it panicked. Fixed, with a test.
