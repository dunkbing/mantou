// Window control against the real core, headless: requests reach the core as JSON, state changes
// reach onState, and a dragRegion asks to move the window.
import { afterEach, expect, test } from "bun:test";
import { mount, View, win, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore();
  open.push(h);
  let bar!: Node;
  mount(h.ui, () => <View ref={(n: Node) => (bar = n)} dragRegion style={{ width: 200, height: 30 }} />);
  h.step();
  return { h, bar };
}

test("window requests reach the core as JSON", async () => {
  const { h } = app();
  const p = win.setFullscreen(true);
  h.step();
  await p;
  expect(h.lastService()).toEqual({ kind: "window", op: "fullscreen", value: true });
  win.setPosition(120, 80);
  h.step();
  expect(h.lastService()).toEqual({ kind: "window", op: "position", x: 120, y: 80 });
  win.setAlwaysOnTop();
  h.step();
  expect(h.lastService()).toEqual({ kind: "window", op: "alwaysOnTop", value: true });
});

test("state changes from the core reach onState", () => {
  const { h } = app();
  const seen: unknown[] = [];
  win.onState((s) => seen.push(s));
  h.ui.dispatchWindowState(1 | 4, 10, -20);
  expect(seen).toEqual([{ focused: true, minimized: false, maximized: true, fullscreen: false, dark: false, x: 10, y: -20 }]);
});

test("pressing a dragRegion asks to move the window", () => {
  const { h, bar } = app();
  h.pointer("down", 20, 10);
  h.step();
  expect(h.lastService()).toEqual({ kind: "window", op: "drag" });
  h.pointer("up", 20, 10);
});

test("win.close asks the core to close like the button, and the safe area is zero without an overlay", () => {
  const { h } = app();
  win.close();
  h.step();
  expect(h.lastService()).toEqual({ kind: "window", op: "close" });
  expect(win.safeArea).toEqual({ top: 0, left: 0 });
});

// #56: a dragRegion needs no paint, alone or in a sidebar's shape (padded column, negative margins).
test("an empty unpainted dragRegion in a sidebar asks to move the window", () => {
  const h = new HeadlessCore();
  open.push(h);
  let strip!: Node;
  mount(h.ui, () => (
    <View style={{ flexDirection: "row", width: 600, height: 400 }}>
      <View style={{ width: 228, padding: 12, backgroundColor: "#eee" }}>
        <View ref={(n: Node) => (strip = n)} dragRegion style={{ height: 38, flexShrink: 0, marginLeft: -12, marginRight: -12 }} />
        <View style={{ height: 100 }} />
      </View>
    </View>
  ));
  h.step();
  expect(h.hit(100, 20)).toBe(strip);
  h.pointer("down", 100, 20);
  h.step();
  expect(h.lastService()).toEqual({ kind: "window", op: "drag" });
  h.pointer("up", 100, 20);
});
