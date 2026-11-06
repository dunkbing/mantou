// Contact sheets and the motion check, on the real core, headless.
import { afterEach, expect, test } from "bun:test";
import { View, createSignal, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => ReturnType<typeof View>) {
  const h = new HeadlessCore({ width: 200, height: 100 });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("a contact sheet lays frames out in a grid", () => {
  const [x, setX] = createSignal(0);
  const h = app(() => <View transition={{ translateX: { duration: 300, easing: "linear" } }} style={{ width: 20, height: 20, backgroundColor: "#ffffff", translateX: x() }} />);
  setX(150);
  h.step();
  const sheet = h.strip({ frames: 6, every: 60, cols: 3, crop: [0, 0, 200, 40] });
  expect([sheet.width, sheet.height]).toEqual([3 * 200 + 2 * 4, 2 * 40 + 4]);
  // The white box is further right in each frame: find it in the first row of each.
  const xs = [0, 1, 2, 3, 4, 5].map((i) => {
    const ox = (i % 3) * 204, oy = Math.floor(i / 3) * 44 + 10;
    for (let x = 0; x < 200; x++) if (sheet.pixels[((oy * sheet.width) + ox + x) * 4] > 200) return x;
    return -1;
  });
  expect(xs).toEqual([0, 30, 60, 90, 120, 150]);
}, 60_000); // the first capture on a software GPU compiles its shaders

test("clean motion has no findings", () => {
  const [x, setX] = createSignal(0);
  const h = app(() => <View testId="box" transition={{ translateX: { spring: { stiffness: 300, damping: 25 } } }} style={{ width: 20, height: 20, translateX: x() }} />);
  expect(h.checkMotion(() => setX(120))).toEqual([]);
  // Interrupted mid-way: the motion bends, it doesn't jump.
  expect(h.checkMotion(() => setX(0), { ms: 80 }).filter((f) => f.kind === "jump")).toEqual([]);
  expect(h.checkMotion(() => setX(60))).toEqual([]);
});

test("jumps, flicker and endless animations are reported", () => {
  let box!: Node, blink!: Node, spin!: Node;
  const h = app(() => (
    <View>
      <View ref={box} testId="box" style={{ width: 20, height: 20 }} />
      <View ref={blink} testId="blink" style={{ width: 20, height: 20 }} />
      <View ref={spin} testId="spinner" style={{ width: 20, height: 20 }} />
    </View>
  ));
  const found = h.checkMotion(() => {
    box.animate("translateX", { keyframes: [0, 0, 160, 160], duration: 150, easing: "linear" }); // still, then a lurch
    blink.animate("opacity", { keyframes: [1, 0, 1, 0, 1], duration: 400, easing: "linear" });
    spin.animate("rotate", { from: 0, to: 360, duration: 800, easing: "linear", iterations: Infinity });
  });
  expect(found.map((f) => `${f.kind} ${f.node}`).sort()).toEqual(["flicker blink", "jump box", "never-settles spinner"]);
  expect(h.checkMotion(() => {}, { ms: 100, allow: ["spinner"] })).toEqual([]);
});
