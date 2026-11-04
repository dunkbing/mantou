// Window control against the real core, headless: requests reach the core as JSON, state changes
// reach onState, and a dragRegion asks to move the window.
import { afterEach, expect, test } from "bun:test";
import { mount, View, win } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore();
  open.push(h);
  let bar!: any;
  mount(h.ui, () => <View ref={(n: any) => (bar = n)} dragRegion style={{ width: 200, height: 30 }} />);
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
