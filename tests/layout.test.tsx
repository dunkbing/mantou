// Layout on the real core, headless: absolutely positioned views, and apps
// hearing about sizes (onLayout, useWindowSize). The first and last tests are
// the reproductions in dunkbing/mantou#1 and #3.
import { afterEach, expect, test } from "bun:test";
import { mount, Text, View, createEffect, createSignal, useWindowSize, type Node, type Rect } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => ReturnType<typeof View>, size = { width: 640, height: 400 }) {
  const h = new HeadlessCore(size);
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("right/bottom resolve against the parent (#1)", () => {
  let child!: Node;
  const h = app(() => (
    <View style={{ flexGrow: 1, flexDirection: "row" }}>
      <View style={{ width: 100 }} />
      <View style={{ width: 200, height: 100 }}>
        <View ref={child} style={{ position: "absolute", right: 0, bottom: 0, width: 10, height: 10 }} />
      </View>
    </View>
  ));
  expect(h.rect(child)).toEqual([290, 90, 300, 100]);
});

test("onLayout hears a view's box after the first layout and when it changes", () => {
  const boxes: Rect[] = [];
  let side!: Node;
  const [wide, setWide] = createSignal(false);
  const h = app(() => (
    <View style={{ flexGrow: 1, flexDirection: "row" }}>
      <View ref={side} style={{ width: wide() ? 300 : 200 }} />
      <View style={{ flexGrow: 1 }} onLayout={(r) => boxes.push(r)} />
    </View>
  ));
  expect(boxes).toEqual([{ x: 200, y: 0, width: 440, height: 400 }]);
  setWide(true);
  h.step();
  expect(boxes.at(-1)).toEqual({ x: 300, y: 0, width: 340, height: 400 });
  h.resize(500, 300);
  expect(boxes.at(-1)).toEqual({ x: 300, y: 0, width: 200, height: 300 });
  expect(boxes.length).toBe(3);
  h.step();
  expect(boxes.length).toBe(3); // nothing changed: no event
  void side;
});

test("useWindowSize follows resizes, in logical px", () => {
  const seen: string[] = [];
  const h = app(() => {
    const size = useWindowSize();
    createEffect(() => seen.push(`${size().width}x${size().height}@${size().scale}`));
    return <View />;
  });
  h.resize(800, 500);
  h.resize(800, 500, 2);
  expect(seen).toEqual(["640x400@1", "800x500@1", "800x500@2"]);
});

test("a scroll area keeps its limit right after a resize (#3)", () => {
  // The app's own scrolling: content moved up by a negative margin, clamped to
  // content − viewport. The viewport's height comes from onLayout.
  const [viewport, setViewport] = createSignal(0);
  const [offset, setOffset] = createSignal(0);
  const contentHeight = 30 * 20;
  const limit = () => Math.max(0, contentHeight - viewport());
  createEffect(() => setOffset((o) => Math.min(o, limit())));
  const h = app(() => (
    <View style={{ flexGrow: 1, overflow: "hidden" }} onLayout={(r) => setViewport(r.height)}>
      <View style={{ marginTop: -offset(), flexShrink: 0 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <View style={{ height: 30, flexShrink: 0 }}>
            <Text>{`Row ${i}`}</Text>
          </View>
        ))}
      </View>
    </View>
  ));
  expect(viewport()).toBe(400);
  setOffset(limit()); // scrolled to the end: 200
  h.step();
  h.resize(640, 500);
  expect(viewport()).toBe(500);
  expect(offset()).toBe(100); // still at the end, not past it
});
