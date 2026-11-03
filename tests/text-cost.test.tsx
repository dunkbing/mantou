// dunkbing/mantou#9: a commit's text work follows what's drawn, not how many
// Text nodes the tree holds. Counts, not timings: `textLayouts` counts
// layouts computed (not reused), `scenes` the scenes built.
import { afterEach, expect, test } from "bun:test";
import { For, Scroll, Text, View, createSignal, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const N = 4200; // past the engine cache's 4,096 entries
const rows = Array.from({ length: N }, (_, i) => i);

/** The issue's clipped list, scrolled the old way (a negative margin), plus a label outside it. */
function marginList() {
  const h = new HeadlessCore({ width: 800, height: 600 });
  open.push(h);
  const [y, setY] = createSignal(0);
  const [label, setLabel] = createSignal("Inbox");
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <Text>{label()}</Text>
      <View style={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
        <View style={{ marginTop: -y(), flexShrink: 0 }}>
          <For each={rows}>{(i) => <View style={{ height: 40, flexShrink: 0 }}><Text>{`Row ${i}`}</Text></View>}</For>
        </View>
      </View>
    </View>
  ));
  h.step();
  return { h, setY, setLabel };
}

test("scrolling a clipped list lays out only the rows that come into view", () => {
  const { h, setY } = marginList();
  const first = h.stats().textLayouts;
  expect(first).toBeLessThan(N + 200); // each row measured once, the visible ones also drawn at their width
  for (let i = 1; i <= 10; i++) {
    setY(i * 40);
    h.step();
  }
  // Ten commits, one new row in view each (plus at most a few re-measured).
  expect(h.stats().textLayouts - first).toBeLessThanOrEqual(20);
});

test("changing one label outside the list lays out that label, not every row", () => {
  const { h, setLabel } = marginList();
  const before = h.stats().textLayouts;
  setLabel("Inbox (3)");
  h.step();
  expect(h.stats().textLayouts - before).toBeLessThanOrEqual(2); // measured, then drawn at its width
});

test("a step with nothing pending builds no scene", () => {
  const { h } = marginList();
  const before = h.stats().scenes;
  h.step();
  h.step();
  expect(h.stats().scenes).toBe(before);
});

test("a core-driven Scroll of 4,200 rows: the wheel lays out only rows coming into view", () => {
  const h = new HeadlessCore({ width: 800, height: 600 });
  open.push(h);
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <Scroll style={{ flexGrow: 1, minHeight: 0 }}>
        <For each={rows}>{(i) => <View style={{ height: 40 }}><Text>{`Row ${i}`}</Text></View>}</For>
      </Scroll>
    </View>
  ));
  h.step();
  const before = h.stats();
  for (let i = 0; i < 10; i++) h.wheel(100, 100, 40);
  const after = h.stats();
  expect(after.layouts).toBe(before.layouts); // no relayout
  expect(after.textLayouts - before.textLayouts).toBeLessThanOrEqual(10);
  expect(after.scenes - before.scenes).toBe(10);
});
