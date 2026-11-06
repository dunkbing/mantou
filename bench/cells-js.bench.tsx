// 3,000 cells whose colours change from JS every frame (one signal): the cost of a big reactive update, from the
// signal to the new scene: Solid's effects, encoding the ops, one commit, applying it, layout and the scene.
import { Index, View, createSignal, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { breakdown, delta, report, summary, time } from "./lib";

const N = 3000;
const COLOURS = ["#3b82f6", "#f97316", "#16a34a", "#e11d48", "#a855f7"] as const;
const h = new HeadlessCore({ width: 600, height: 500 });
const [tick, setTick] = createSignal(0);
mount(h.ui, () => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", width: 600 }}>
    <Index each={Array.from({ length: N })}>{(_, i) => <View style={{ width: 10, height: 10, backgroundColor: COLOURS[(i + tick()) % COLOURS.length] }} />}</Index>
  </View>
));
h.step();
const before = h.stats();
const frames = time((i) => {
  setTick(i + 1);
  h.step();
}, 60, 5);
const d = delta(before, h.stats());
const f = summary(frames);
const core = (d.applyMicros + d.layoutMicros + d.sceneMicros) / 1000 / 65;
report({
  cells: N,
  "frame median ms": f.median,
  "frame p95 ms": f.p95,
  "ops/frame": d.ops / 65,
  "commits/frame": d.commits / 65,
  ...breakdown(d, 65),
  "JS (effects, encoding) ms/frame": Math.max(0, f.median - core),
});
h.free();
