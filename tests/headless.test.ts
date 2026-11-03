// The real native core, headless: tree, layout, hit-testing, press dispatch and
// the renderer, with no window. Needs `bun run build:core` and, for captures,
// a GPU adapter (Mesa's lavapipe on Linux CI).
import { afterEach, expect, test } from "bun:test";
import { counter } from "../examples/counter/counter";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
const headless = (o?: ConstructorParameters<typeof HeadlessCore>[0]) => {
  const h = new HeadlessCore(o);
  open.push(h);
  return h;
};
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("the counter lays out as designed", () => {
  const h = headless({ width: 520, height: 320 });
  const c = counter(h.ui);
  h.step();
  expect(h.rect(c.plus)).toEqual([24, 24, 112, 68]);
  expect(h.rect(c.minus)).toEqual([124, 24, 212, 68]);
  expect(h.rect(c.board)).toEqual([24, 84, 496, 296]);
  expect(h.stats()).toMatchObject({ commits: 1, opErrors: 0, quads: 5, nodes: 6 });
});

test("a press is hit-tested by the core, reaches the handler, and its commit is 4 ops", () => {
  const h = headless({ width: 520, height: 320 });
  const c = counter(h.ui);
  h.step();
  const before = h.stats();
  h.press(c.plus);
  expect(c.count()).toBe(1);
  expect(h.ui.lastCommitOps).toBe(4);
  const s = h.stats();
  expect(s.presses - before.presses).toBe(1);
  expect(s.commits - before.commits).toBe(1);
  expect(s.quads).toBe(6);
  // Dots are 28 px squares, laid out inside the board's 12 px padding.
  expect(h.rect(c.board.children[0])).toEqual([36, 96, 64, 124]);
});

test("a press away from any listener does nothing; a drag off the button is not a press", () => {
  const h = headless({ width: 520, height: 320 });
  const c = counter(h.ui);
  h.step();
  h.press([300, 200]); // the board: no listener on its path
  const [x, y] = h.center(c.plus);
  h.pointer("down", x, y).pointer("move", 300, 200).pointer("up", 300, 200);
  expect(c.count()).toBe(0);
  expect(h.stats().presses).toBe(0);
  expect(h.received.pointerDown).toBe(2);
});

test("the squares wrap onto new rows as they fill the board", () => {
  const h = headless({ width: 520, height: 320 });
  const c = counter(h.ui);
  for (let i = 0; i < 14; i++) h.press(c.plus);
  // 448 px of board content fits 12 squares of 28 px with 8 px gaps per row.
  expect(h.rect(c.board.children[11])![1]).toBe(96);
  expect(h.rect(c.board.children[12])).toEqual([36, 132, 64, 160]);
  h.press(c.reset);
  expect(c.count()).toBe(0);
  expect(h.stats()).toMatchObject({ nodes: 6, quads: 5 });
});

test("resizing relayouts without the app; layout is in device pixels at the scale", () => {
  const h = headless({ width: 520, height: 320, scale: 2 });
  const c = counter(h.ui);
  h.step();
  expect(h.rect(c.board)).toEqual([24, 84, 496, 296]);
  expect(h.scene()).toContain("quad 48 48 224 136 #16a34aff"); // + at 2×
  const commits = h.stats().commits;
  h.resize(300, 200);
  expect(h.rect(c.board)).toEqual([24, 84, 276, 176]);
  expect(h.stats().commits).toBe(commits);
  expect(h.received.resized).toBe(1);
});

test("the scene dump is stable", () => {
  const h = headless({ width: 200, height: 100 });
  const root = h.ui.view({ padding: 10, backgroundColor: "#202020" });
  root.append(h.ui.view({ height: 20, backgroundColor: "#ff000080" }));
  h.ui.setRoot(root);
  h.ui.clearColor(0, 0, 0, 1);
  expect(h.scene()).toBe(["size 200x100", "clear #000000ff", "quad 0 0 200 100 #202020ff", "quad 10 10 190 30 #ff000080", ""].join("\n"));
});

test("captured pixels show what the scene says", () => {
  const h = headless({ width: 520, height: 320 });
  const c = counter(h.ui);
  h.press(c.plus);
  const shot = h.capture();
  expect([shot.width, shot.height]).toEqual([520, 320]);
  expect(shot.at(5, 5)).toEqual([0x11, 0x13, 0x18, 255]); // root background
  expect(shot.at(60, 40)).toEqual([0x16, 0xa3, 0x4a, 255]); // +
  expect(shot.at(160, 40)).toEqual([0xdc, 0x26, 0x26, 255]); // −
  expect(shot.at(50, 110)).toEqual([0xf5, 0x9e, 0x0b, 255]); // the first square
  expect(shot.at(300, 200)).toEqual([0x1f, 0x24, 0x30, 255]); // the board
  expect(h.stats().frames).toBe(1);
});

test("instances are independent", () => {
  const a = headless(), b = headless();
  const ca = counter(a.ui), cb = counter(b.ui);
  a.press(ca.plus).press(ca.plus);
  b.press(cb.plus);
  expect([ca.count(), cb.count()]).toEqual([2, 1]);
  expect([a.stats().nodes, b.stats().nodes]).toEqual([8, 7]);
});
