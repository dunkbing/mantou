// <Canvas> against the real core, headless: the scene lists its shapes, and a capture's pixels show them.
import { afterEach, expect, test } from "bun:test";
import { Canvas, View, createSignal, mount } from "mantou-ui";
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

const quads = (h: HeadlessCore) => h.scene().split("\n").filter((l) => l.startsWith("quad"));

function pixel(h: HeadlessCore, x: number, y: number) {
  const cap = h.capture();
  return Array.from(cap.pixels.slice((y * cap.width + x) * 4, (y * cap.width + x) * 4 + 4));
}

test("shapes come out where they were drawn, from the canvas's corner", () => {
  const h = app(() => (
    <View style={{ padding: 20 }}>
      <Canvas width={100} height={80} draw={(g) => g.fillRect(10, 5, 30, 20, "#ff0000").circle(60, 40, 10, "#00ff00")} />
    </View>
  ));
  const q = quads(h);
  expect(q[0]).toContain("quad 30 25 60 45 #ff0000ff");
  expect(q[1]).toContain("quad 70 50 90 70 #00ff00ff radius 10");
});

test("a line is a turned thin rectangle; pixels follow it", () => {
  const h = app(() => <Canvas width={100} height={100} draw={(g) => g.line(0, 0, 100, 100, "#ff0000", 4)} />);
  expect(quads(h)[0]).toContain("rotate 45");
  const on = pixel(h, 50, 50);
  const off = pixel(h, 80, 20);
  expect(on[0]).toBeGreaterThan(200);
  expect(on[1]).toBeLessThan(60); // red on the line
  expect(off).not.toEqual(on); // the background off it
});

test("an axis-aligned line stays a plain rectangle", () => {
  const h = app(() => <Canvas width={100} height={50} draw={(g) => g.line(0, 10, 100, 10, "#0000ff", 2)} />);
  expect(quads(h)[0]).not.toContain("rotate");
});

test("it draws again when a signal it reads changes", () => {
  const [w, setW] = createSignal(10);
  const h = app(() => <Canvas width={100} height={50} draw={(g) => g.fillRect(0, 0, w(), 10, "#ff0000")} />);
  expect(quads(h)[0]).toContain("quad 0 0 10 10");
  setW(40);
  h.step();
  expect(quads(h)[0]).toContain("quad 0 0 40 10");
});

test("shapes are cut to the canvas's box", () => {
  const h = app(() => (
    <View style={{ padding: 20 }}>
      <Canvas width={50} height={50} draw={(g) => g.fillRect(0, 0, 150, 150, "#ff0000")} />
    </View>
  ));
  expect(pixel(h, 40, 40)[0]).toBeGreaterThan(200); // inside
  expect(pixel(h, 120, 120)).not.toEqual(pixel(h, 40, 40)); // outside the box
});
