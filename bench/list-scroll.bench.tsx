// A 10,000-row List scrolled by the wheel: the core scrolls at once, and the List adds and drops rows from JS.
import { List, Text, View, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { delta, report, summary, time } from "./lib";

const ROWS = 10_000;
const items = Array.from({ length: ROWS }, (_, i) => ({ id: i, name: `Message ${i}`, preview: `A preview of message number ${i}, long enough to fill the row` }));
const h = new HeadlessCore({ width: 400, height: 600 });
const mountStart = performance.now();
mount(h.ui, () => (
  <View style={{ flexGrow: 1, minHeight: 0 }}>
    <List each={items} itemHeight={44} style={{ flexGrow: 1 }}>
      {(item) => (
        <View style={{ paddingLeft: 12, paddingTop: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: 600 }}>{item().name}</Text>
          <Text style={{ fontSize: 12, color: "#6b7280", maxLines: 1 }}>{item().preview}</Text>
        </View>
      )}
    </List>
  </View>
));
h.step();
const firstFrame = performance.now() - mountStart;
const before = h.stats();
const scrolls = time(() => h.wheel(200, 300, 120), 200, 10);
const d = delta(before, h.stats());
const s = summary(scrolls);
report({
  rows: ROWS,
  "first frame ms": firstFrame,
  "scroll median ms": s.median,
  "scroll p95 ms": s.p95,
  "commits/scroll": d.commits / 210,
  "nodes alive": h.stats().nodes,
});
h.free();
