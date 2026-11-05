// Displays (dunkbing/mantou#70) and remembering a window's state between launches (dunkbing/mantou#67),
// on the real core, headless: the window's answers are queued, as a test answers a dialog.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, monitors, View, win } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { loadWindow, rememberWindow, restoredOptions, saveWindow, setWindowStateDir } from "../runtime/winstate";

let dir = "";
const open: HeadlessCore[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mantou-winstate-"));
  setWindowStateDir(dir);
});
afterEach(() => {
  open.splice(0).forEach((h) => h.free());
  setWindowStateDir(undefined);
  rmSync(dir, { recursive: true, force: true });
});

function app() {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => <View />);
  h.step();
  return h;
}
const file = () => JSON.parse(readFileSync(join(dir, "window-state.json"), "utf8"));
const state = (s: object) => ({ x: 0, y: 0, width: 640, height: 400, focused: true, minimized: false, maximized: false, fullscreen: false, dark: false, ...s });

test("monitors() lists the displays the core reports; win.monitor() is the window's", async () => {
  const h = app();
  const displays = [
    { name: "Built-in", x: 0, y: 0, width: 1512, height: 982, scale: 2, refreshRate: 120, primary: true, current: false },
    { name: "Studio", x: 1512, y: -200, width: 2560, height: 1440, scale: 1, refreshRate: 60, primary: false, current: true },
  ];
  h.answer(displays).answer(displays);
  const all = monitors();
  h.step();
  expect(await all).toEqual(displays);
  expect(h.lastService()).toEqual({ kind: "monitors" });
  const mine = win.monitor();
  h.step();
  expect((await mine)?.name).toBe("Studio");
  // No window to ask (unanswered): no displays.
  const none = monitors();
  h.step();
  expect(await none).toEqual([]);
});

test("nothing saved: the app's options stand; saved: its box and state replace them", () => {
  expect(restoredOptions("main", { width: 900, height: 600, title: "Mail" })).toEqual({ options: { width: 900, height: 600, title: "Mail" }, saved: null });
  saveWindow("main", { x: 40, y: 60, width: 1000, height: 700, maximized: true, fullscreen: false });
  saveWindow("compose", { width: 500, height: 400, maximized: false, fullscreen: false });
  const { options } = restoredOptions("main", { width: 900, height: 600, x: 0, y: 0, title: "Mail" });
  expect(options).toEqual({ width: 1000, height: 700, x: 40, y: 60, maximized: true, fullscreen: false, title: "Mail" });
  // Another window's entry is kept; one saved without a position keeps the app's.
  expect(restoredOptions("compose", { x: 5, y: 6 }).options).toEqual({ x: 5, y: 6, width: 500, height: 400, maximized: false, fullscreen: false });
});

test("a broken or odd file is ignored", () => {
  writeFileSync(join(dir, "window-state.json"), "{ not json");
  expect(loadWindow("main")).toBeNull();
  writeFileSync(join(dir, "window-state.json"), JSON.stringify({ main: { width: "big", height: 600 }, b: { width: 0, height: 10 }, c: { width: 300.4, height: 200, x: 1 } }));
  expect(loadWindow("main")).toBeNull();
  expect(loadWindow("b")).toBeNull();
  expect(loadWindow("c")).toEqual({ width: 300, height: 200, maximized: false, fullscreen: false }); // no y: no position
});

test("the normal box is kept while maximized; a minimized window saves nothing", async () => {
  const h = app();
  const r = rememberWindow(h.ui, "main", null);
  const save = async (s: object) => {
    h.answer(state(s));
    const p = r.save();
    h.step();
    await p;
  };
  await save({ x: 10, y: 20, width: 500, height: 300 });
  expect(file().main).toEqual({ x: 10, y: 20, width: 500, height: 300, maximized: false, fullscreen: false });
  await save({ x: 0, y: 0, width: 1920, height: 1050, maximized: true });
  expect(file().main).toEqual({ x: 10, y: 20, width: 500, height: 300, maximized: true, fullscreen: false });
  await save({ x: -32000, y: -32000, minimized: true });
  expect(file().main).toEqual({ x: 10, y: 20, width: 500, height: 300, maximized: true, fullscreen: false });
  await save({ x: 30, y: 40, width: 520, height: 310 });
  expect(file().main).toEqual({ x: 30, y: 40, width: 520, height: 310, maximized: false, fullscreen: false });
  r.stop();
});

test("a resize or a state change saves a moment later", async () => {
  const h = app();
  const r = rememberWindow(h.ui, "main", null, 0);
  h.answer(state({ x: 7, y: 8, width: 700, height: 500 }));
  h.ui.dispatchResize(700, 500, 1);
  for (let i = 0; i < 1000 && !loadWindow("main"); i++) {
    await Bun.sleep(1);
    h.step();
  }
  expect(loadWindow("main")).toEqual({ x: 7, y: 8, width: 700, height: 500, maximized: false, fullscreen: false });
  r.stop();
});
