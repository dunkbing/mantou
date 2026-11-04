// Files dropped on the window against the real core, headless: routed to the view under the
// pointer's last position, bubbling, dragover enter/leave, and the window-level fallback.
import { afterEach, expect, test } from "bun:test";
import { mount, View, onFileDrop } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(log: string[]) {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => (
    <View style={{ width: 400, height: 300 }}>
      <View
        style={{ width: 100, height: 100 }}
        onDrop={(e) => log.push(`drop ${e.files.join(",")}`)}
        onDragOver={(e) => log.push(e ? "over" : "left")}
      />
    </View>
  ));
  onFileDrop((kind, e) => log.push(`window ${kind} ${e.files.length}`));
  h.step();
  return h;
}

test("files dropped over a view reach it; elsewhere, the window", () => {
  const log: string[] = [];
  const h = app(log);
  h.hover([50, 50]);
  h.dropFiles("over", ["/a.png"]);
  h.dropFiles("drop", ["/a.png", "/b.png"]);
  expect(log).toEqual(["over", "drop /a.png,/b.png"]);
  log.length = 0;
  h.hover([300, 200]);
  h.dropFiles("drop", ["/c.png"]);
  expect(log).toEqual(["window 2 1"]);
});

test("leaving the window tells the view that was over", () => {
  const log: string[] = [];
  const h = app(log);
  h.hover([50, 50]);
  h.dropFiles("over", ["/a.png"]);
  h.dropFiles("leave");
  expect(log).toEqual(["over", "left"]);
});
