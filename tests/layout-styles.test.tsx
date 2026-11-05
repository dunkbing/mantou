// Grid, aspectRatio, pointerEvents, fixed and sticky positioning against the real core, headless.
import { afterEach, expect, test } from "bun:test";
import { mount, View, Scroll, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => any) {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, ui);
  h.step();
  return h;
}

test("gridColumns makes equal columns; gridColumnSpan covers more", () => {
  const cells: Node[] = [];
  const cell = (span?: number) => <View ref={(n: Node) => cells.push(n)} style={{ height: 40, gridColumnSpan: span }} />;
  const h = app(() => (
    <View style={{ width: 300, display: "grid", gridColumns: 3, columnGap: 0, rowGap: 0 }}>
      {cell()}{cell()}{cell()}{cell(2)}{cell()}
    </View>
  ));
  const r = cells.map((c) => h.rect(c)!);
  expect(r[0].slice(0, 3)).toEqual([0, 0, 100]);
  expect(r[1][0]).toBe(100);
  expect(r[2][0]).toBe(200);
  expect(r[3][0]).toBe(0); // second row
  expect(r[3][1]).toBe(40);
  expect(r[3][2]).toBe(200); // two columns wide
  expect(r[4][0]).toBe(200);
});

test("gridMinColumnWidth fits as many columns as it can", () => {
  const cells: Node[] = [];
  const h = app(() => (
    <View style={{ width: 450, display: "grid", gridMinColumnWidth: 100, columnGap: 0, rowGap: 0 }}>
      {[0, 1, 2, 3, 4].map(() => <View ref={(n: Node) => cells.push(n)} style={{ height: 20 }} />)}
    </View>
  ));
  const r = cells.map((c) => h.rect(c)!);
  expect(r[0][2]).toBe(112.5); // four columns of 112.5
  expect(r[4][1]).toBe(20); // the fifth wraps
});

test("aspectRatio derives the height from the width", () => {
  let box!: Node;
  const h = app(() => <View ref={(n: Node) => (box = n)} style={{ width: 200, aspectRatio: 2 }} />);
  expect(h.rect(box)![3]).toBe(100);
});

test("pointerEvents none lets the pointer through to what is below", () => {
  let below!: Node, over!: Node;
  const h = app(() => (
    <View style={{ width: 100, height: 100 }}>
      <View ref={(n: Node) => (below = n)} style={{ position: "absolute", top: 0, left: 0, width: 100, height: 100 }} />
      <View ref={(n: Node) => (over = n)} style={{ position: "absolute", top: 0, left: 0, width: 100, height: 100, pointerEvents: "none" }} />
    </View>
  ));
  expect(h.hit(50, 50)).toBe(below);
});

test("fixed stays where it is on the window while the content scrolls", () => {
  let badge!: Node, scroll!: Node;
  const h = app(() => (
    <View style={{ width: 400, height: 300 }}>
      <Scroll ref={(n: Node) => (scroll = n)} style={{ width: 400, height: 300 }}>
        <View style={{ height: 1000 }}>
          <View ref={(n: Node) => (badge = n)} style={{ position: "fixed", right: 10, bottom: 10, width: 50, height: 20 }} />
        </View>
      </Scroll>
    </View>
  ));
  const at = h.rect(badge)!;
  expect(at).toEqual([580, 370, 630, 390]); // against the 640 × 400 window, not the 400 × 300 scroll view
  scroll.scrollTo({ y: 200 });
  h.step();
  expect(h.rect(badge)).toEqual(at);
});

test("sticky sticks to the top of its scroll view, and stops at the bottom of its parent", () => {
  let head!: Node, scroll!: Node;
  const h = app(() => (
    <Scroll ref={(n: Node) => (scroll = n)} style={{ width: 400, height: 300 }}>
      <View style={{ height: 1000 }}>
        <View style={{ height: 200 }}>
          <View ref={(n: Node) => (head = n)} style={{ position: "sticky", top: 8, height: 30 }} />
        </View>
      </View>
    </Scroll>
  ));
  expect(h.rect(head)![1]).toBe(8); // its place is 0, but it keeps 8 from the top
  scroll.scrollTo({ y: 100 });
  h.step();
  expect(h.rect(head)![1]).toBe(8); // follows the top while its parent (0..200) is in view
  scroll.scrollTo({ y: 250 });
  h.step();
  expect(h.rect(head)![1]).toBe(200 - 250 - 30); // the parent's bottom has pushed it up
});
