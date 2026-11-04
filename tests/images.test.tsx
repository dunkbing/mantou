// Reference images (dunkbing/mantou#11): headless captures compared with the
// PNGs in tests/images/ (see runtime/images.ts). Write or refresh them with
// `MANTOU_UPDATE_IMAGES=1 bun run test:headless`, and look at what changed.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { Scroll, Text, View, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { Counter } from "../examples/counter/Counter";
import { Todos } from "../examples/todos/Todos";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function shot(width: number, height: number, scale: number, ui: () => ReturnType<typeof View>) {
  const h = new HeadlessCore({ width, height, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("the counter after three presses", () => {
  const h = shot(520, 320, 1, () => <Counter />);
  for (let i = 0; i < 3; i++) h.press([68, 46]);
  expect(h.capture()).toMatchImage("counter");
});

for (const scale of [1, 2]) {
  test(`the to-do example at scale ${scale}`, () => {
    const h = shot(420, 520, scale, () => (
      <Todos initial={[{ text: "Buy rice", done: true }, { text: "Call Ana about the trip", done: false }, { text: "Water the plants", done: false }]} />
    ));
    h.type("Pick up the par"); // the field has the focus: text and a caret
    expect(h.capture()).toMatchImage(`todos@${scale}x`);
  });

  test(`text: sizes, weights, italics, alignment and an ellipsis at scale ${scale}`, () => {
    const h = shot(360, 260, scale, () => (
      <View style={{ flexGrow: 1, padding: 12, gap: 6, backgroundColor: "#ffffff" }}>
        <Text style={{ fontSize: 12 }}>12 px regular: the quick brown fox</Text>
        <Text style={{ fontSize: 14, fontWeight: 500 }}>14 px medium: jumps over</Text>
        <Text style={{ fontSize: 18, fontWeight: 600 }}>18 px semibold: the lazy dog</Text>
        <Text style={{ fontSize: 28, fontWeight: 700 }}>28 px bold</Text>
        <Text style={{ fontSize: 14, fontStyle: "italic", color: "#2563eb" }}>Italic, in blue</Text>
        <Text style={{ fontSize: 14, textAlign: "center", backgroundColor: "#f3f4f6" }}>Centred</Text>
        <Text style={{ fontSize: 14, textAlign: "end" }}>At the end</Text>
        <Text style={{ fontSize: 14, maxLines: 1, width: 200, backgroundColor: "#fef3c7" }}>A line far too long to fit, cut off with an ellipsis</Text>
      </View>
    ));
    expect(h.capture()).toMatchImage(`text@${scale}x`);
  });

  test(`boxes: radii, borders, opacity, clipping and a scrollbar at scale ${scale}`, () => {
    const h = shot(360, 200, scale, () => (
      <View style={{ flexGrow: 1, padding: 12, gap: 12, backgroundColor: "#f8fafc" }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ width: 48, height: 48, backgroundColor: "#ef4444" }} />
          <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: "#f59e0b" }} />
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#10b981" }} />
          <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: "#334155" }} />
          <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 4, borderColor: "#6366f1", backgroundColor: "#e0e7ff" }} />
          <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: "#0ea5e9", opacity: 0.4 }} />
        </View>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "start" }}>
          <View style={{ width: 120, height: 60, overflow: "hidden", backgroundColor: "#e2e8f0" }}>
            <View style={{ width: 200, height: 30, marginLeft: 60, marginTop: 40, backgroundColor: "#8b5cf6" }} />
          </View>
          <Scroll style={{ width: 120, height: 80, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#cbd5e1" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <View style={{ height: 24, backgroundColor: i % 2 ? "#f1f5f9" : "#ffffff" }} />
            ))}
          </Scroll>
        </View>
      </View>
    ));
    expect(h.capture()).toMatchImage(`boxes@${scale}x`);
  });
}
