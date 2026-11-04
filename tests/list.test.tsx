// The virtualized List on the real core, headless (dunkbing/mantou#19):
// 100,000 rows, a bounded node count, and work per scroll that doesn't
// depend on the row count.
import { afterEach, expect, test } from "bun:test";
import { List, Text, View, createSignal, mount, type ListHandle, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const ROW = 40;

function list(n: number) {
  const h = new HeadlessCore({ width: 400, height: 400 });
  open.push(h);
  const [items, setItems] = createSignal(Array.from({ length: n }, (_, i) => `Message ${i}`));
  let handle!: ListHandle;
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <List each={items()} itemHeight={ROW} overscan={3} style={{ flexGrow: 1, minHeight: 0 }} ref={(l) => (handle = l)}>
        {(item) => (
          <View style={{ flexGrow: 1, paddingLeft: 8, justifyContent: "center" }}>
            <Text>{item()}</Text>
          </View>
        )}
      </List>
    </View>
  ));
  h.step();
  /** The text of the row at a point, from the core's hit-testing. */
  const textAt = (x: number, y: number) => {
    const find = (n: Node | null | undefined): string | undefined => (n?.isText ? n.textContent : n?.elements.map(find).find((t) => t !== undefined));
    return find(h.hit(x, y));
  };
  return { h, handle: () => handle, textAt, setItems };
}

test("100,000 rows: only a screenful (plus overscan) exists", () => {
  const { h, handle, textAt } = list(100_000);
  expect(handle().range()).toEqual([0, 13]); // 10 rows in view, 3 more below
  expect(h.stats().nodes).toBeLessThan(60);
  expect(textAt(20, 20)).toBe("Message 0");
  expect(textAt(20, 390)).toBe("Message 9");
});

test("scrolling with the wheel: rows come and go, and each step's ops are few", () => {
  const { h, handle, textAt } = list(100_000);
  h.wheel(100, 100, 400); // ten rows down
  expect(textAt(20, 20)).toBe("Message 10");
  expect(handle().range()).toEqual([7, 23]);
  const nodes = h.stats().nodes;
  const ops: number[] = [];
  for (let i = 0; i < 5; i++) {
    h.wheel(100, 100, ROW);
    ops.push(h.ui.lastCommitOps);
  }
  expect(textAt(20, 20)).toBe("Message 15");
  expect(h.stats().nodes).toBe(nodes); // as many rows as before
  // One row in, one row out: the same ops whatever the list's length.
  const small = list(1_000);
  small.h.wheel(100, 100, 400);
  const smallOps: number[] = [];
  for (let i = 0; i < 5; i++) {
    small.h.wheel(100, 100, ROW);
    smallOps.push(small.h.ui.lastCommitOps);
  }
  expect(ops).toEqual(smallOps);
  for (const n of ops) expect(n).toBeLessThanOrEqual(24);
});

test("scrollToIndex reaches rows that don't exist yet", () => {
  const { h, handle, textAt } = list(100_000);
  handle().scrollToIndex(50_000, { block: "center" });
  h.step();
  expect(textAt(20, 200)).toBe("Message 50000");
  handle().scrollToIndex(99_999);
  h.step();
  expect(textAt(20, 390)).toBe("Message 99999"); // nearest: at the bottom
  handle().scrollToIndex(0, { block: "start" });
  h.step();
  expect(textAt(20, 20)).toBe("Message 0");
});

test("rows follow the items; a shorter list clamps the offset", () => {
  const { h, handle, textAt, setItems } = list(1_000);
  setItems((xs) => xs.map((x, i) => (i === 0 ? "Pinned" : x)));
  h.step();
  expect(textAt(20, 20)).toBe("Pinned");
  handle().scrollToIndex(999);
  h.step();
  setItems(Array.from({ length: 20 }, (_, i) => `Short ${i}`));
  h.step();
  expect(textAt(20, 390)).toBe("Short 19"); // 20 rows of 40 in 400 px: the end
});

test("rows of different heights: a function of the item places them (#31)", () => {
  const h = new HeadlessCore({ width: 400, height: 400 });
  open.push(h);
  // Mantou Mail's rows: 66 px, 90 px with chips (every third message here).
  type Msg = { id: number; chips: boolean };
  const [items, setItems] = createSignal<Msg[]>(Array.from({ length: 50_000 }, (_, id) => ({ id, chips: id % 3 === 0 })));
  let handle!: ListHandle;
  let made = 0;
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <List each={items()} itemHeight={(m) => (m.chips ? 90 : 66)} overscan={2} style={{ flexGrow: 1, minHeight: 0 }} ref={(l) => (handle = l)}>
        {(m) => {
          made++;
          return <View style={{ flexGrow: 1 }}><Text>{`Message ${m().id}`}</Text></View>;
        }}
      </List>
    </View>
  ));
  h.step();
  const textAt = (y: number) => {
    const find = (n: Node | null | undefined): string | undefined => (n?.isText ? n.textContent : n?.elements.map(find).find((t) => t !== undefined));
    return find(h.hit(4, y));
  };
  // Every three rows take 90 + 66 + 66 = 222 px.
  const top = (i: number) => Math.floor(i / 3) * 222 + [0, 90, 156][i % 3];
  // 400 px shows rows 0..5 (they start at 0, 90, 156, 222, 312, 378), and 2 more exist below.
  expect(handle.range()).toEqual([0, 8]);
  expect(textAt(top(4) + 1)).toBe("Message 4");
  expect(h.rect(h.hit(4, top(4) + 1)!.parent!)?.[3]).toBe(top(5)); // row 4 ends where row 5 starts
  // scrollToIndex lands on a row's own top, whatever the heights above it.
  handle.scrollToIndex(30_001, { block: "start" });
  h.step();
  expect(handle.node.scrollOffset.y).toBe(top(30_001));
  expect(textAt(1)).toBe("Message 30001");
  expect(handle.range()).toEqual([29_999, 30_009]); // rows 30,001..30,006 start within 400 px, 2 more each side
  // The content is as tall as the rows: the end is reachable, and no further.
  handle.node.scrollTo({ y: 1e9 });
  h.step();
  expect(handle.node.scrollOffset.y).toBe(top(50_000) - 400);
  expect(handle.range()[1]).toBe(50_000);
  expect(textAt(399)).toBe("Message 49999");
  // A row above the view that grows moves the rows below down, without new rows.
  handle.scrollToIndex(30_001, { block: "start" });
  h.step();
  made = 0;
  const rowNode = h.hit(4, 30)!;
  setItems((all) => all.map((m) => (m.id === 29_000 ? { ...m, chips: true } : m))); // far above: 24 px taller
  h.step();
  // The offset stayed, so everything below moved down 24 px: row 30,000 is now at the top.
  expect(textAt(1)).toBe("Message 30000");
  expect(made).toBe(1); // only the row that came into range (29,998); the others moved
  expect(h.hit(4, 30 + 24)).toBe(rowNode); // row 30,001's own node, moved
});
