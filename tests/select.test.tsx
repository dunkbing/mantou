// Selectable static text against the real core, headless: dragging selects, double click picks
// a word, Cmd/Ctrl+C copies, and clicking elsewhere clears it.
import { afterEach, expect, test } from "bun:test";
import { mount, Text, View, clipboard } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore();
  open.push(h);
  let text!: any;
  let plain!: any;
  mount(h.ui, () => (
    <View style={{ width: 300, gap: 20 }}>
      <Text ref={(n: any) => (text = n)} selectable style={{ fontSize: 16 }}>hello brave world</Text>
      <Text ref={(n: any) => (plain = n)} style={{ fontSize: 16 }}>not selectable</Text>
    </View>
  ));
  h.step();
  return { h, text, plain };
}

const quads = (h: HeadlessCore) => h.scene().split("\n").filter((l) => l.startsWith("quad")).length;

async function copied(h: HeadlessCore) {
  h.key("c", { primary: true });
  const p = clipboard.readText();
  h.step();
  return p;
}

test("dragging over selectable text selects it, and copy puts it on the clipboard", async () => {
  const { h, text } = app();
  const [x0, y0, x1, y1] = h.rect(text)!;
  const before = quads(h);
  h.pointer("down", x0 + 1, (y0 + y1) / 2);
  h.pointer("move", x1 - 1, (y0 + y1) / 2);
  h.pointer("up", x1 - 1, (y0 + y1) / 2);
  expect(quads(h)).toBeGreaterThan(before); // the highlight
  expect(await copied(h)).toBe("hello brave world");
});

test("a double click selects a word", async () => {
  const { h, text } = app();
  const [x0, y0, x1, y1] = h.rect(text)!;
  const mid = x0 + 70; // inside "brave"
  h.pointer("down", mid, (y0 + y1) / 2);
  h.pointer("up", mid, (y0 + y1) / 2);
  h.pointer("down", mid, (y0 + y1) / 2);
  h.pointer("up", mid, (y0 + y1) / 2);
  expect(await copied(h)).toBe("brave");
});

test("text that isn't selectable can't be selected, and clicking away clears the selection", async () => {
  const { h, text, plain } = app();
  const [px0, py0, px1, py1] = h.rect(plain)!;
  h.pointer("down", px0 + 1, (py0 + py1) / 2);
  h.pointer("move", px1 - 1, (py0 + py1) / 2);
  h.pointer("up", px1 - 1, (py0 + py1) / 2);
  expect(await copied(h)).toBeNull();
  const [x0, y0, x1, y1] = h.rect(text)!;
  h.pointer("down", x0 + 1, (y0 + y1) / 2);
  h.pointer("move", x1 - 1, (y0 + y1) / 2);
  h.pointer("up", x1 - 1, (y0 + y1) / 2);
  h.pointer("down", px0 + 1, (py0 + py1) / 2);
  h.pointer("up", px0 + 1, (py0 + py1) / 2);
  expect(await copied(h)).toBeNull();
});
