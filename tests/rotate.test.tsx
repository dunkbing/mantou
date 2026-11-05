// style.rotate against the real core, headless: boxes, what's inside them and the pointer turn together.
import { afterEach, expect, test } from "bun:test";
import { Text, View, createSignal, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => any) {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, ui);
  h.step();
  return h;
}
function pixel(h: HeadlessCore, x: number, y: number) {
  const cap = h.capture();
  return Array.from(cap.pixels.slice((y * cap.width + x) * 4, (y * cap.width + x) * 4 + 4));
}
const RED = [255, 0, 0, 255];

test("a quarter turn stands a bar up about its centre", () => {
  const h = app(() => (
    <View style={{ padding: 50 }}>
      <View style={{ width: 100, height: 20, backgroundColor: "#ff0000", rotate: 90 }} />
    </View>
  ));
  expect(pixel(h, 100, 100)).toEqual(RED); // where the bar's end now is
  expect(pixel(h, 100, 20)).toEqual(RED);
  expect(pixel(h, 60, 60)).not.toEqual(RED); // where it was
  expect(pixel(h, 140, 60)).not.toEqual(RED);
});

test("the pointer follows the turned box", () => {
  let n = 0;
  const h = app(() => (
    <View style={{ padding: 50 }}>
      <View onPress={() => n++} style={{ width: 100, height: 20, backgroundColor: "#ff0000", rotate: 90 }} />
    </View>
  ));
  h.press([100, 100]);
  expect(n).toBe(1);
  h.press([60, 60]);
  expect(n).toBe(1);
});

test("nested turns add up", () => {
  const h = app(() => (
    <View style={{ padding: 40, width: 200, height: 200 }}>
      <View style={{ rotate: 30 }}>
        <View style={{ width: 80, height: 40, backgroundColor: "#0000ff", rotate: 60 }} />
      </View>
    </View>
  ));
  expect(h.scene()).toContain("rotate 90"); // 30 + 60
});

/** The box around the dark pixels of a white window. */
function ink(h: HeadlessCore) {
  const cap = h.capture();
  let [x0, y0, x1, y1] = [1e9, 1e9, -1, -1];
  for (let y = 0; y < cap.height; y++)
    for (let x = 0; x < cap.width; x++) if (cap.pixels[(y * cap.width + x) * 4] < 128) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

test("text turns with its view", () => {
  const text = (rotate: number) =>
    app(() => (
      <View style={{ width: 200, height: 200, backgroundColor: "#ffffff", padding: 80 }}>
        <View style={{ rotate }}>
          <Text style={{ fontSize: 40, color: "#000000" }}>I</Text>
        </View>
      </View>
    ));
  const upright = ink(text(0));
  expect(upright.h).toBeGreaterThan(upright.w * 2); // a tall stroke
  const lying = ink(text(90));
  expect(lying.w).toBeGreaterThan(lying.h * 2); // now a wide one
});

test("rotate animates like scale", () => {
  const [r, setR] = createSignal(0);
  const h = app(() => (
    <View style={{ padding: 50 }}>
      <View transition={{ rotate: 100 }} style={{ width: 100, height: 20, backgroundColor: "#ff0000", rotate: r() }} />
    </View>
  ));
  setR(90);
  h.step();
  h.step(300);
  expect(pixel(h, 100, 100)).toEqual(RED);
});
