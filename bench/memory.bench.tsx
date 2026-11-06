// Memory: what Mantou costs at rest, per node, for a long list and an HTML mail, and whether mounting and
// disposing a UI over and over leaves anything behind. Each figure is measured after a full garbage collection;
// "native" is the resident set (Bun, the core, the GPU driver) less the JS heap, "JS" the JS heap. The resident set
// moves with the allocators (they keep freed memory), so leaks are counted in objects and nodes, which don't.
import { heapStats } from "bun:jsc";
import { memory, report } from "./lib";

const start = memory(); // Bun and the JSX plugin (Babel), as `mantou dev` and tests run; a packaged app has no Babel
const { For, Html, Index, List, Text, View, mount } = await import("mantou-ui");
const { HeadlessCore } = await import("../runtime/headless");
const { MESSAGE } = await import("../examples/mail/message");
const loaded = memory();
const h = new HeadlessCore({ width: 600, height: 500 });
const empty = mount(h.ui, () => <View />);
h.step();
const atRest = memory();
h.capture();
const drawn = memory();
empty();
h.step();

/** Memory a UI takes once mounted and laid out (MB), then gone again. */
function cost(ui: () => ReturnType<typeof View>) {
  const before = memory();
  const dispose = mount(h.ui, ui);
  h.step();
  const after = memory();
  dispose();
  h.step();
  return { rss: after.rss - before.rss, heap: after.heap - before.heap };
}

const VIEWS = 10_000, TEXTS = 2_000;
const views = cost(() => (
  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
    <Index each={Array.from({ length: VIEWS })}>{() => <View style={{ width: 4, height: 4, backgroundColor: "#3b82f6" }} />}</Index>
  </View>
));
const texts = cost(() => (
  <View>
    <Index each={Array.from({ length: TEXTS })}>{(_, i) => <Text style={{ fontSize: 13 }}>{`Line ${i}: the quick brown fox jumps over the lazy dog`}</Text>}</Index>
  </View>
));
const rows = Array.from({ length: 10_000 }, (_, i) => `Message ${i}`);
const list = cost(() => (
  <View style={{ flexGrow: 1, minHeight: 0 }}>
    <List each={rows} itemHeight={32} style={{ flexGrow: 1 }}>{(r) => <Text>{r()}</Text>}</List>
  </View>
));
const html = cost(() => <Html html={MESSAGE} style={{ width: "100%" }} />);

// Mount and dispose 3,000 nodes, over and over: the core's node count comes back, and the JS objects alive after a
// garbage collection stay the same (a few per mount, from Solid's root, whatever the UI's size).
const nodes0 = h.stats().nodes;
const cycle = () => {
  const dispose = mount(h.ui, () => (
    <View>
      <For each={Array.from({ length: 3000 }, (_, i) => i)}>{(i) => <View style={{ height: 2, backgroundColor: i % 2 ? "#000000" : "#ffffff" }} />}</For>
    </View>
  ));
  h.step();
  dispose();
  h.step();
};
for (let i = 0; i < 20; i++) cycle();
Bun.gc(true);
const objects0 = heapStats().objectCount;
const ROUNDS = 50;
for (let i = 0; i < ROUNDS; i++) cycle();
Bun.gc(true);

const kb = (mb: number, n: number) => (mb * 1024) / n;
report({
  "Bun and the JSX plugin MB": start.rss,
  "mantou-ui loaded MB": loaded.rss,
  "an empty instance MB": atRest.rss,
  "after the first frame drawn (GPU) MB": drawn.rss,
  "a view, native KB": kb(views.rss - views.heap, VIEWS),
  "a view, JS KB": kb(views.heap, VIEWS),
  "a Text, native KB": kb(texts.rss - texts.heap, TEXTS),
  "a Text, JS KB": kb(texts.heap, TEXTS),
  "a 10,000-row List MB": list.rss,
  "an HTML mail MB": html.rss,
  "mount and dispose 3,000 nodes: JS objects left per round": (heapStats().objectCount - objects0) / ROUNDS,
  "mount and dispose 3,000 nodes: core nodes left": h.stats().nodes - nodes0,
});
h.free();

export {};
