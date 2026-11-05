// Pointer events on views against the real core, headless: down, move, up, context menu,
// double click, capture while a button is held, and bubbling.
import { afterEach, expect, test } from "bun:test";
import { mount, View, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(log: string[]) {
  const h = new HeadlessCore();
  open.push(h);
  let box!: Node;
  mount(h.ui, () => (
    <View style={{ width: 400, height: 300 }} onPointerDown={(e) => log.push(`outer-down`)}>
      <View
        ref={(n: Node) => (box = n)}
        style={{ width: 100, height: 100 }}
        onPointerDown={(e) => log.push(`down b${e.button} c${e.clicks}`)}
        onPointerMove={(e) => log.push(`move ${e.x},${e.y}`)}
        onPointerUp={(e) => log.push(`up b${e.button}`)}
        onContextMenu={(e) => log.push(`context b${e.button}`)}
        onDoubleClick={() => log.push("double")}
      />
    </View>
  ));
  h.step();
  return { h, box };
}

test("down, move and up reach the node, and down bubbles", () => {
  const log: string[] = [];
  const { h } = app(log);
  h.pointer("move", 10, 10);
  h.pointer("down", 10, 10);
  h.pointer("up", 10, 10);
  expect(log).toEqual(["move 10,10", "down b0 c1", "outer-down", "up b0"]);
});

test("a held button captures: moves outside the node still reach it", () => {
  const log: string[] = [];
  const { h } = app(log);
  h.pointer("down", 10, 10);
  h.pointer("move", 300, 250);
  h.pointer("up", 300, 250);
  expect(log).toContain("move 300,250");
  expect(log).toContain("up b0");
  log.length = 0;
  h.pointer("move", 300, 250); // released: no longer follows
  expect(log).toEqual([]);
});

test("the secondary button is a context menu, a second click a double click", () => {
  const log: string[] = [];
  const { h } = app(log);
  h.pointerButton("down", 2, 10, 10);
  h.pointerButton("up", 2, 10, 10);
  expect(log).toEqual(["down b2 c1", "context b2", "outer-down", "up b2"]);
  log.length = 0;
  h.pointer("down", 10, 10);
  h.pointer("up", 10, 10);
  h.pointer("down", 10, 10);
  expect(log.filter((l) => l === "double")).toHaveLength(1);
});
