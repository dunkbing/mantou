// 3,000 cells animated by the core (opacity and a colour, forever): what each frame costs on the main thread
// (advancing the animations, placing boxes, building the scene), with no JS. Like BUI's 3,000-cell benchmark.
import { Index, View, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { breakdown, delta, report, rssMB, summary, time } from "./lib";

const N = 3000;
const h = new HeadlessCore({ width: 600, height: 500 });
const cells: Node[] = [];
mount(h.ui, () => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", width: 600 }}>
    <Index each={Array.from({ length: N })}>{(_, i) => <View ref={(n) => (cells[i] = n)} style={{ width: 10, height: 10, backgroundColor: "#3b82f6" }} />}</Index>
  </View>
));
h.step();
cells.forEach((c, i) => {
  c.animate("opacity", { from: 0.2, to: 1, duration: 600 + (i % 7) * 50, iterations: Infinity, alternate: true });
  c.animate("backgroundColor", { from: "#3b82f6", to: "#f97316", duration: 900, iterations: Infinity, alternate: true });
});
h.step();
const before = h.stats();
const frames = time(() => h.step(16), 120, 10);
const d = delta(before, h.stats());
const f = summary(frames);
const draw = summary(time(() => h.capture(), 10, 2));
console.log(`GPU ${info(h)}`);
report({
  cells: N,
  "frame median ms": f.median,
  "frame p95 ms": f.p95,
  ...breakdown(d, 130),
  "draw + read back median ms": draw.median,
  "rss MB": rssMB(),
});
h.free();

function info(h: HeadlessCore) {
  const b = new Uint8Array(512);
  return new TextDecoder().decode(b.subarray(0, h.lib.symbols.mt_info(b, b.length)));
}
