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
