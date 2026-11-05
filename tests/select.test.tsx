// Selectable static text against the real core, headless: dragging selects, double click picks
// a word, Cmd/Ctrl+C copies, and clicking elsewhere clears it.
import { afterEach, expect, test } from "bun:test";
import { mount, Text, View, clipboard, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore();
  open.push(h);
  let text!: Node;
  let plain!: Node;
  mount(h.ui, () => (
    <View style={{ width: 300, gap: 20 }}>
      <Text ref={(n: Node) => (text = n)} selectable style={{ fontSize: 16 }}>hello brave world</Text>
      <Text ref={(n: Node) => (plain = n)} style={{ fontSize: 16 }}>not selectable</Text>
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

function article() {
  const h = new HeadlessCore();
  open.push(h);
  const t: Node[] = [];
  mount(h.ui, () => (
    <View selectable style={{ width: 300, gap: 20 }}>
      <Text ref={(n: Node) => (t[0] = n)} style={{ fontSize: 16 }}>First line</Text>
      <Text ref={(n: Node) => (t[1] = n)} style={{ fontSize: 16 }}>Second line</Text>
      <Text ref={(n: Node) => (t[2] = n)} style={{ fontSize: 16 }}>Third line</Text>
    </View>
  ));
  h.step();
  return { h, t };
}

test("a selectable View selects across its Texts, and copy joins them by lines", async () => {
  const { h, t } = article();
  const [a0, a1] = [h.rect(t[0])!, h.rect(t[2])!];
  h.pointer("down", a0[0] + 40, (a0[1] + a0[3]) / 2); // in "First line", before "line"
  h.pointer("move", a1[0] + 40, (a1[1] + a1[3]) / 2); // in "Third line"
  h.pointer("up", a1[0] + 40, (a1[1] + a1[3]) / 2);
  const text = (await copied(h))!;
  expect(text.split("\n").length).toBe(3);
  expect(text).toContain("Second line"); // the one between is whole
  expect(text.startsWith("First line")).toBe(false); // the first starts where the press was
  expect(text.endsWith("Third line")).toBe(false); // the last ends where the pointer is
});

test("dragging back up and Select All", async () => {
  const { h, t } = article();
  const [a0, a1] = [h.rect(t[0])!, h.rect(t[1])!];
  h.pointer("down", a1[0] + 30, (a1[1] + a1[3]) / 2);
  h.pointer("move", a0[0] + 5, (a0[1] + a0[3]) / 2);
  h.pointer("up", a0[0] + 5, (a0[1] + a0[3]) / 2);
  const up = (await copied(h))!;
  expect(up.split("\n").length).toBe(2); // part of the first, and the start of the second
  h.key("a", { primary: true });
  expect(await copied(h)).toBe("First line\nSecond line\nThird line");
});

test("a selection in a View stays inside it", async () => {
  const h = new HeadlessCore();
  open.push(h);
  const t: Node[] = [];
  mount(h.ui, () => (
    <View style={{ width: 300, gap: 20 }}>
      <View selectable><Text ref={(n: Node) => (t[0] = n)} style={{ fontSize: 16 }}>inside</Text></View>
      <Text ref={(n: Node) => (t[1] = n)} style={{ fontSize: 16 }}>outside</Text>
    </View>
  ));
  h.step();
  const [a, b] = [h.rect(t[0])!, h.rect(t[1])!];
  h.pointer("down", a[0] + 1, (a[1] + a[3]) / 2);
  h.pointer("move", b[2] - 1, (b[1] + b[3]) / 2);
  h.pointer("up", b[2] - 1, (b[1] + b[3]) / 2);
  expect(await copied(h)).toBe("inside");
});
