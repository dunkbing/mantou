// Platform services against the real core, headless: requests reach the core as
// JSON, answers come back as events and resolve the promises (design §10).
import { afterEach, expect, test } from "bun:test";
import { mount, View, openFile, saveFile, message, showMenu, setMenu, onMenu } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
function app() {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => <View />);
  h.step();
  return h;
}
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("openFile sends its options and resolves to the queued answer", async () => {
  const h = app();
  h.answer(["/tmp/a.png", "/tmp/b.png"]);
  const p = openFile({ multiple: true, filters: [{ name: "Images", extensions: ["png"] }] });
  h.step();
  expect(await p).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  expect(h.lastService()).toEqual({ kind: "openFile", multiple: true, filters: [{ name: "Images", extensions: ["png"] }] });
});

test("an unanswered or cancelled request resolves to null", async () => {
  const h = app();
  const a = saveFile({ name: "x.txt" });
  h.step();
  expect(await a).toBeNull();
  h.answer(null);
  const b = openFile();
  h.step();
  expect(await b).toBeNull();
});

test("answers are used in order, one per request", async () => {
  const h = app();
  h.answer(1).answer("copy");
  const m = message({ message: "Delete?", buttons: ["Delete", "Cancel"], level: "warning" });
  const c = showMenu([{ id: "copy", label: "Copy" }], { x: 10, y: 20 });
  h.step();
  expect(await m).toBe(1);
  expect(await c).toBe("copy");
  expect(h.lastService()).toEqual({ kind: "showMenu", items: [{ id: "copy", label: "Copy" }], x: 10, y: 20 });
});

test("a long answer (larger than the 64 KB event buffer) survives", async () => {
  const h = app();
  const path = "/tmp/" + "é".repeat(40000);
  h.answer(path);
  const p = saveFile();
  h.step();
  expect(await p).toBe(path);
});

test("menu items reach onMenu, and setMenu sends the menus", async () => {
  const h = app();
  const chosen: string[] = [];
  onMenu((id) => chosen.push(id));
  h.answer(true);
  const set = setMenu([{ label: "File", items: [{ id: "open", label: "Open…", accelerator: "cmd+o" }, { separator: true }, { role: "quit" }] }]);
  h.step();
  expect(await set).toBe(true);
  expect((h.lastService() as unknown as { menu: { label: string }[] }).menu[0].label).toBe("File");
  h.chooseMenu("open").chooseMenu("save");
  expect(chosen).toEqual(["open", "save"]);
});
