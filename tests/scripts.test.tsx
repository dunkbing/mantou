// Colour emoji, right-to-left and mixed-direction text, and combining marks
// (dunkbing/mantou#16), on the real core, headless. The test fonts are
// bundled (tests/fonts) so the images are the same on every OS.
import "mantou-ui/images";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Input, Text, View, mount, type JSX, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));
const font = (name: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fonts", name)));

function app(ui: () => JSX.Element, scale = 1) {
  const h = new HeadlessCore({ width: 420, height: 260, scale });
  open.push(h);
  h.ui.registerFont(font("MantouTestEmoji.ttf"));
  h.ui.registerFont(font("MantouTestScripts.ttf"));
  mount(h.ui, ui);
  return h.step();
}

const emoji = ["Inter", "Mantou Test Emoji"];
const scripts = ["Inter", "Mantou Test Scripts"];

test("emoji keep their colours, beside text that takes the text colour", () => {
  const h = app(() => (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 24, color: "#111827", fontFamily: emoji }}>Ship it 🚀 👍🏽</Text>
    </View>
  ));
  const scene = h.scene();
  // The two emoji are image quads from the colour atlas; the letters are glyphs.
  expect(scene.match(/^image /gm)?.length).toBe(2);
  expect(scene).toMatch(/glyphs 6/); // "Shipit": the spaces draw nothing
});

test("Hebrew and Arabic run right to left, inside left-to-right text and on their own", () => {
  let mixed!: Node, hebrew!: Node;
  const h = app(() => (
    <View style={{ padding: 16, gap: 8, alignItems: "start" }}>
      <Text ref={mixed} style={{ fontSize: 18, fontFamily: scripts }}>abc שלום def</Text>
      <Text ref={hebrew} style={{ fontSize: 18, fontFamily: scripts }}>שלום עולם</Text>
    </View>
  ));
  expect(h.scene()).toMatch(/glyphs 18/); // 6 Latin + 4 Hebrew in the first line, 8 Hebrew in the second
  expect(h.rect(mixed)![2]).toBeGreaterThan(h.rect(mixed)![0]);
  expect(h.rect(hebrew)).toBeTruthy();
});

test("typing Hebrew into an input keeps the text in logical order", () => {
  let input!: Node;
  const h = app(() => (
    <View style={{ padding: 16 }}>
      <Input ref={input} autoFocus style={{ width: 240, height: 32, fontSize: 16, fontFamily: scripts }} />
    </View>
  ));
  h.type("abc ");
  h.type("שלום");
  expect(input.value).toBe("abc שלום");
  h.key("Backspace"); // removes the last letter typed, whatever the direction it's drawn in
  expect(input.value).toBe("abc שלו");
});

test("emoji, scripts and combining marks at 1× and 2×", () => {
  for (const scale of [1, 2]) {
    const h = app(
      () => (
        <View style={{ flexGrow: 1, padding: 16, gap: 10, backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: 22, color: "#111827", fontFamily: emoji }}>Launch day 🚀🎉 ❤️ 👩‍💻 🇯🇵 😀</Text>
          <Text style={{ fontSize: 13, color: "#6b7280", fontFamily: emoji }}>Small too: 👍 👍🏽 at 13 px</Text>
          <Text style={{ fontSize: 18, color: "#111827", fontFamily: scripts }}>Hello שלום world, مرحبا 123</Text>
          <Text style={{ fontSize: 18, color: "#111827", fontFamily: scripts }}>שלום עולם</Text>
          <Text style={{ fontSize: 18, color: "#111827" }}>{"Tiếng Việt, café, naïve, Ελληνικά, Русский"}</Text>
        </View>
      ),
      scale,
    );
    expect(h.capture()).toMatchImage(`scripts@${scale}x`);
  }
});
