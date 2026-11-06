// 1,000 paragraphs in a scroll view: the first layout (every paragraph shaped and measured), then relayouts
// at new widths (each paragraph wrapped again), as when the window is resized.
import { For, Scroll, Text, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { delta, report, summary, time } from "./lib";

const N = 1000;
const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");
const paragraphs = Array.from({ length: N }, (_, i) => Array.from({ length: 36 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" "));
const h = new HeadlessCore({ width: 600, height: 800 });
const t = performance.now();
mount(h.ui, () => (
  <Scroll style={{ flexGrow: 1 }} contentStyle={{ padding: 12, gap: 8 }}>
    <For each={paragraphs}>{(p) => <Text style={{ fontSize: 14, lineHeight: 20 }}>{p}</Text>}</For>
  </Scroll>
));
h.step();
const first = performance.now() - t;
const before = h.stats();
// A new width each time, as while dragging the window's edge (a width seen before would come from the caches).
const resizes = time((i) => h.resize(600 - i * 6, 800), 20, 2);
const d = delta(before, h.stats());
const r = summary(resizes);
report({
  paragraphs: N,
  "first layout ms": first,
  "relayout at a new width median ms": r.median,
  "text layouts/relayout": d.textLayouts / 22,
  "layout ms/relayout": d.layoutMicros / 1000 / 22,
});
h.free();
