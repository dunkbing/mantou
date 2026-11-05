// Files dropped on the window against the real core, headless: routed to the view under the
// pointer's last position, bubbling, dragover enter/leave, and the window-level fallback.
import { afterEach, expect, test } from "bun:test";
import { mount, View, onFileDrop, type Node } from "mantou-ui";
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

test("a draggable view dropped on another view hands over its data", () => {
  const log: string[] = [];
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => (
    <View style={{ width: 400, height: 300, flexDirection: "row" }}>
      <View draggable={{ id: 7 }} style={{ width: 100, height: 100 }} />
      <View
        style={{ width: 100, height: 100 }}
        onDragOver={(e) => log.push(e ? `over ${JSON.stringify(e.data)}` : "left")}
        onDrop={(e) => log.push(`drop ${JSON.stringify(e.data)}`)}
      />
    </View>
  ));
  h.step();
  h.pointer("down", 50, 50);
  h.pointer("move", 52, 50); // under the threshold: nothing yet
  expect(log).toEqual([]);
  h.pointer("move", 150, 50);
  h.pointer("move", 160, 60);
  h.pointer("move", 300, 200);
  h.pointer("move", 150, 50);
  h.pointer("up", 150, 50);
  expect(log).toEqual(['over {"id":7}', "left", 'over {"id":7}', 'drop {"id":7}']);
});

test("a drag's preview follows the pointer in the core, held where it was grabbed, and goes on drop", () => {
  const h = new HeadlessCore();
  open.push(h);
  let preview: Node | undefined;
  const dropped: unknown[] = [];
  mount(h.ui, () => (
    <View style={{ width: 400, height: 300, flexDirection: "row", padding: 20 }}>
      <View
        draggable={{ id: 3 }}
        dragPreview={() => <View ref={preview} style={{ width: 80, height: 24, backgroundColor: "#2563eb" }} />}
        style={{ width: 100, height: 40, flexShrink: 0 }}
      />
      <View style={{ width: 100, height: 100 }} onDrop={(e) => dropped.push(e.data)} />
    </View>
  ));
  h.step();
  const nodes = h.ui.nodes.size;
  h.pointer("down", 30, 25); // 10, 5 inside the draggable
  h.pointer("move", 32, 25);
  expect(preview).toBeUndefined(); // not a drag yet
  h.pointer("move", 60, 60);
  expect(h.rect(preview!)).toEqual([50, 55, 130, 79]); // its top left 10, 5 up and left of the pointer
  const commits = h.ui.commits;
  for (const [x, y] of [[80, 70], [200, 120], [390, 290]] as const) {
    h.pointer("move", x, y);
    expect(h.rect(preview!)).toEqual([x - 10, y - 5, x + 70, y + 19]);
  }
  expect(h.ui.commits).toBe(commits); // moved by the core: no ops
  expect(h.hit(200, 120)).not.toBe(preview!); // the pointer goes through it
  h.pointer("move", 170, 50);
  h.pointer("up", 170, 50);
  expect(dropped).toEqual([{ id: 3 }]);
  expect(h.rect(preview!)).toBeNull(); // gone
  expect(h.ui.nodes.size).toBe(nodes); // and released
});

test("Escape cancels a drag: the target hears it leave, nothing drops, the preview goes", () => {
  const h = new HeadlessCore();
  open.push(h);
  const log: string[] = [];
  let preview: Node | undefined;
  mount(h.ui, () => (
    <View style={{ width: 400, height: 300, flexDirection: "row" }}>
      <View draggable="a" dragPreview={() => <View ref={preview} style={{ width: 20, height: 20 }} />} style={{ width: 100, height: 100, flexShrink: 0 }} />
      <View style={{ width: 100, height: 100 }} onDragOver={(e) => log.push(e ? "over" : "left")} onDrop={() => log.push("drop")} />
    </View>
  ));
  h.step();
  h.pointer("down", 50, 50);
  h.pointer("move", 150, 50);
  expect(log).toEqual(["over"]);
  h.key("Escape");
  expect(log).toEqual(["over", "left"]);
  expect(h.ui.dragging).toBe(false);
  expect(h.rect(preview!)).toBeNull();
  h.pointer("move", 160, 60); // still held: no new drag
  h.pointer("up", 160, 60);
  expect(log).toEqual(["over", "left"]);
});
