// Text styles against the real core, headless: letterSpacing, textTransform, whiteSpace,
// textOverflow and textDecoration.
import { afterEach, expect, test } from "bun:test";
import { mount, Text, View } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

/** A text with this style in a 200 px wide column; its box and the quads drawn. */
function lay(text: string, style: object, width = 200) {
  const h = new HeadlessCore();
  open.push(h);
  let node!: any;
  mount(h.ui, () => (
    <View style={{ width, alignItems: "start" }}>
      <Text ref={(n: any) => (node = n)} style={{ fontSize: 14, ...style }}>{text}</Text>
    </View>
  ));
  h.step();
  const [x0, y0, x1, y1] = h.rect(node)!;
  const quads = h.scene().split("\n").filter((l) => l.startsWith("quad")).length;
  return { w: x1 - x0, h: y1 - y0, quads };
}

test("letterSpacing widens the text", () => {
  expect(lay("spacing", { letterSpacing: 4 }).w).toBeGreaterThan(lay("spacing", {}).w + 20);
});

test("textTransform changes the case before shaping", () => {
  const up = lay("mmmm", { textTransform: "uppercase" }).w;
  expect(up).toBeGreaterThan(lay("mmmm", {}).w);
  expect(lay("MMMM", {}).w).toBeCloseTo(up, 3);
  expect(lay("MMMM", { textTransform: "lowercase" }).w).toBeCloseTo(lay("mmmm", {}).w, 3);
  expect(lay("hello world", { textTransform: "capitalize" }).w).toBeCloseTo(lay("Hello World", {}).w, 3);
});

test("whiteSpace nowrap keeps one line; clip cuts without an ellipsis", () => {
  const long = "one two three four five six seven eight nine ten eleven twelve";
  const wrapped = lay(long, {});
  expect(wrapped.h).toBeGreaterThan(30);
  const nowrap = lay(long, { whiteSpace: "nowrap" });
  expect(nowrap.h).toBeLessThan(20);
  const ellipsis = lay(long, { whiteSpace: "nowrap", textOverflow: "ellipsis" });
  const clip = lay(long, { whiteSpace: "nowrap", textOverflow: "clip" });
  expect(ellipsis.w).toBeLessThanOrEqual(200);
  expect(clip.w).toBeLessThanOrEqual(200);
  expect(clip.quads).toBeLessThan(ellipsis.quads + 1); // no "…" glyph
});

test("textDecoration draws a line under or through each line", () => {
  const plain = lay("underline me", {}).quads;
  expect(lay("underline me", { textDecoration: "underline" }).quads).toBe(plain + 1);
  expect(lay("underline me", { textDecoration: "lineThrough" }).quads).toBe(plain + 1);
});
