// App fonts on the real core (dunkbing/mantou#8, #14): registerFont and
// fontFamily. The test font is monospace: "iiii" and "MMMM" are the same
// width in it, and not in Inter.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Input, Text, View, defineStyle, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const MONO = new Uint8Array(readFileSync(join(import.meta.dir, "fonts", "MantouTestMono.ttf")));
const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function width(h: HeadlessCore, n: Node) {
  const r = h.rect(n)!;
  return r[2] - r[0];
}

test("text and inputs use a registered font by its family name; the rest stays Inter", () => {
  const h = new HeadlessCore({ width: 400, height: 200 });
  open.push(h);
  h.ui.registerFont(MONO);
  let i!: Node, m!: Node, iInter!: Node, mInter!: Node, field!: Node;
  const mono = defineStyle({ fontFamily: "Mantou Test Mono" });
  mount(h.ui, () => (
    <View style={{ alignItems: "start", padding: 8 }}>
      <Text ref={i} style={mono}>iiii</Text>
      <Text ref={m} style={{ fontFamily: ["Mantou Test Mono", "monospace"] }}>MMMM</Text>
      <Text ref={iInter}>iiii</Text>
      <Text ref={mInter}>MMMM</Text>
      <Input ref={field} style={{ fontFamily: "Mantou Test Mono", width: 200 }} defaultValue="iiii" />
    </View>
  ));
  h.step();
  expect(Math.abs(width(h, i) - width(h, m))).toBeLessThan(0.5);
  expect(width(h, mInter)).toBeGreaterThan(2 * width(h, iInter));
  expect(h.stats().opErrors).toBe(0);
  void field;
});

test("each family list is sent once, however many nodes use it", async () => {
  const { MockCore } = await import("../runtime/mock");
  const core = new MockCore();
  mount(core.ui, () => (
    <View>
      {Array.from({ length: 5 }, () => <Text style={{ fontFamily: "Lucide" }}>x</Text>)}
    </View>
  ));
  await core.settle();
  expect(core.commits[0].filter((o) => o.op === "FONT_FAMILY")).toEqual([{ op: "FONT_FAMILY", family: 1, names: "Lucide" }]);
});

test("a reference image of a registered font", () => {
  const h = new HeadlessCore({ width: 320, height: 90 });
  open.push(h);
  h.ui.registerFont(MONO);
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, padding: 10, gap: 4, backgroundColor: "#ffffff" }}>
      <Text style={{ fontFamily: "Mantou Test Mono", fontSize: 16 }}>const mono = "same width";</Text>
      <Text style={{ fontFamily: "Mantou Test Mono", fontSize: 16, color: "#2563eb" }}>iiii|MMMM|0123</Text>
      <Text style={{ fontSize: 16 }}>Inter, for comparison</Text>
    </View>
  ));
  expect(h.step().capture()).toMatchImage("fonts");
});
