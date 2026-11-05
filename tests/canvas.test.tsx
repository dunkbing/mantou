// <Canvas> against the real core, headless: the scene lists its shapes, and a capture's pixels show them.
import { afterEach, expect, test } from "bun:test";
import { Canvas, Path, View, createSignal, mount } from "mantou-ui";
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

test("an area fills between a line and the baseline, with no seams between its strips", () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <Canvas width={100} height={100} draw={(g) => g.area([[0, 60], [40, 20], [100, 50]], 100, "#ff0000")} />
  ));
  h.step();
  expect(quads(h).every((l) => l.includes("strip"))).toBe(true);
  const under = pixel(h, 40, 80); // below the line
  const above = pixel(h, 40, 10); // above it
  const edge = pixel(h, 40, 21); // just under the peak
  expect(under).toEqual([255, 0, 0, 255]);
  expect(above).not.toEqual(under);
  expect(edge[0]).toBeGreaterThan(200);
  // The seam between the two segments (x = 40) is as red as its neighbours.
  expect(pixel(h, 39, 80)).toEqual(under);
  expect(pixel(h, 41, 80)).toEqual(under);
});

test("where the line crosses the baseline the fill is on both sides of it", () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <Canvas width={100} height={100} draw={(g) => g.area([[0, 70], [100, 30]], 50, "#0000ff")} />
  ));
  h.step();
  expect(pixel(h, 10, 55)[2]).toBe(255); // between the line (at ~66) and the baseline (50), below it
  expect(pixel(h, 90, 45)[2]).toBe(255); // between the baseline and the line (at ~34), above it
  expect(pixel(h, 10, 20)).not.toEqual([0, 0, 255, 255]);
});

test("translucent strips don't double up where they meet", () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => <Canvas width={100} height={100} draw={(g) => g.area([[0, 30], [40, 20], [100, 40]], 100, "#ff000080")} />);
  h.step();
  expect(pixel(h, 39, 80)).toEqual(pixel(h, 41, 80));
  expect(pixel(h, 40, 80)).toEqual(pixel(h, 41, 80));
});

test("a filled polygon covers its inside, smooths its edges and keeps to its shape", () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => <Canvas width={100} height={100} draw={(g) => g.fillPath([[10, 10], [90, 10], [50, 90]], "#ff0000")} />);
  h.step();
  expect(pixel(h, 50, 30)).toEqual([255, 0, 0, 255]); // inside
  expect(pixel(h, 15, 80)).not.toEqual([255, 0, 0, 255]); // beside the point
  expect(pixel(h, 50, 5)).not.toEqual([255, 0, 0, 255]); // above the top edge
  const outside = pixel(h, 5, 30)[0];
  const edge = pixel(h, 20, 30)[0]; // on the slanted left edge (x = 20.25 there): part covered
  expect(edge).toBeGreaterThan(outside + 20);
  expect(edge).toBeLessThan(250);
});

test("a path with a hole-free donut: arcs out and back, filled", () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <Canvas width={200} height={200} draw={(g) => g.fill(new Path().arc(100, 100, 80, 0, Math.PI * 1.5).arc(100, 100, 40, Math.PI * 1.5, 0).close(), "#0000ff")} />
  ));
  h.step();
  expect(pixel(h, 100, 180 - 1)[2]).toBe(255); // the bottom of the ring (angle PI/2)
  expect(pixel(h, 100, 100)).not.toEqual([0, 0, 255, 255]); // the hole
  expect(pixel(h, 170, 70)).not.toEqual([0, 0, 255, 255]); // the missing quarter (up and right)
  expect(pixel(h, 30, 100)[2]).toBe(255); // the left of the ring
});
