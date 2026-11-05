// Gradients, corners and sides of their own, and zIndex against the real core, headless: what the
// scene says is drawn, and a capture's pixels for the shader.
import { afterEach, expect, test } from "bun:test";
import { mount, View } from "mantou-ui";
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

const quad = (h: HeadlessCore, nth = 0) => h.scene().split("\n").filter((l) => l.startsWith("quad"))[nth];

test("a gradient says its end colour and angle", () => {
  const h = app(() => <View style={{ width: 100, height: 100, backgroundColor: "#ff0000", gradientColor: "#0000ff", gradientAngle: 90 }} />);
  expect(quad(h)).toContain("gradient #0000ffff 90");
});

test("the default gradient runs top to bottom (180)", () => {
  const h = app(() => <View style={{ width: 100, height: 100, backgroundColor: "#ff0000", gradientColor: "#0000ff" }} />);
  expect(quad(h)).toContain("gradient #0000ffff 180");
});

test("corners and sides of their own", () => {
  const h = app(() => (
    <View style={{ width: 100, height: 100, backgroundColor: "#fff", borderRadius: 4, borderTopLeftRadius: 20, borderBottomWidth: 3, borderColor: "#000" }} />
  ));
  const q = quad(h);
  expect(q).toContain("radii [20.0, -1.0, -1.0, -1.0]");
  expect(q).toContain("widths [-1.0, -1.0, 3.0, -1.0]");
});

test("a bottom border takes its room from the content", () => {
  let box!: any, inner!: any;
  const h = app(() => (
    <View ref={(n: any) => (box = n)} style={{ width: 100, borderBottomWidth: 5, borderColor: "#000" }}>
      <View ref={(n: any) => (inner = n)} style={{ height: 10 }} />
    </View>
  ));
  expect(h.rect(box)![3]).toBe(15); // 10 of content and a 5 px border below it
});

test("pixels: a gradient changes along its angle, a lone round corner is cut", () => {
  const h = app(() => <View style={{ width: 100, height: 100, backgroundColor: "#ff0000", gradientColor: "#0000ff", gradientAngle: 90, borderTopLeftRadius: 40 }} />);
  const cap = h.capture();
  const px = (x: number, y: number) => Array.from(cap.pixels.slice((y * cap.width + x) * 4, (y * cap.width + x) * 4 + 4));
  const left = px(5, 90);
  const right = px(95, 90);
  expect(left[0]).toBeGreaterThan(right[0]); // red fades out to the right
  expect(right[2]).toBeGreaterThan(left[2]); // blue comes in
  const background = px(300, 300);
  expect(px(1, 1)).toEqual(background); // the top left corner is rounded away
  expect(px(98, 1)).not.toEqual(background); // the top right is square
});

test("zIndex lifts a view over later siblings, in painting and under the pointer", () => {
  let low!: any, high!: any;
  const h = app(() => (
    <View style={{ width: 100, height: 100 }}>
      <View ref={(n: any) => (high = n)} style={{ position: "absolute", top: 0, left: 0, width: 100, height: 100, zIndex: 5 }} />
      <View ref={(n: any) => (low = n)} style={{ position: "absolute", top: 0, left: 0, width: 100, height: 100 }} />
    </View>
  ));
  expect(h.hit(50, 50)).toBe(high); // later in the tree, but lower
});

function px(h: HeadlessCore, x: number, y: number) {
  const cap = h.capture();
  return Array.from(cap.pixels.slice((y * cap.width + x) * 4, (y * cap.width + x) * 4 + 3));
}
const near = (a: number[], b: number[], d = 6) => a.every((v, i) => Math.abs(v - b[i]) <= d);

test("a middle stop: red, then green at 50%, then blue (left to right)", () => {
  const h = app(() => <View style={{ width: 200, height: 20, backgroundColor: "#ff0000", gradientMidColor: "#00ff00", gradientColor: "#0000ff", gradientAngle: 90 }} />);
  expect(quad(h)).toContain("mid #00ff00ff 50");
  expect(near(px(h, 0, 10), [255, 0, 0], 50)).toBe(true);
  expect(near(px(h, 100, 10), [0, 255, 0], 30)).toBe(true);
  expect(near(px(h, 199, 10), [0, 0, 255], 50)).toBe(true);
});

test("the middle stop can sit elsewhere", () => {
  const h = app(() => <View style={{ width: 200, height: 20, backgroundColor: "#ff0000", gradientMidColor: "#00ff00", gradientMidAt: 25, gradientColor: "#0000ff", gradientAngle: 90 }} />);
  expect(near(px(h, 50, 10), [0, 255, 0], 30)).toBe(true);
});

test("a radial gradient runs from the centre out", () => {
  const h = app(() => <View style={{ width: 100, height: 100, backgroundColor: "#ffffff", gradientColor: "#000000", gradientShape: "radial" }} />);
  expect(quad(h)).toContain("radial");
  expect(px(h, 50, 50)[0]).toBeGreaterThan(235); // white in the middle
  expect(px(h, 0, 0)[0]).toBeLessThan(70); // near black at the corner
});

test("a fade to see-through: the end colour may have no alpha", () => {
  const h = app(() => <View style={{ width: 200, height: 20, backgroundColor: "#ff0000", gradientColor: "#ff000000", gradientAngle: 90 }} />);
  expect(quad(h)).toContain("gradient #ff000000 90");
  const bg = px(h, 100, 100);
  expect(px(h, 1, 10)[0]).toBeGreaterThan(240); // red at the start
  expect(Math.abs(px(h, 198, 10)[0] - bg[0])).toBeLessThan(25); // the window's colour at the end
});
