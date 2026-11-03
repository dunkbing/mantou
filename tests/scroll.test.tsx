// Scroll views on the real core, headless (dunkbing/mantou#5): the core
// scrolls on the wheel and the thumb with no ops from JS; the app scrolls
// with scrollTo and scrollIntoView, and hears onScroll.
import { afterEach, expect, test } from "bun:test";
import { For, Scroll, Text, View, createEffect, createSignal, mount, onKey, type Node, type ScrollOffset } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const ROW = 40;
const messages = Array.from({ length: 50 }, (_, i) => ({ id: i, subject: `Message ${i}` }));

/** A 300 px tall message list at the top of a 400 × 300 window, with j/k selection kept in view. */
function mailbox() {
  const h = new HeadlessCore({ width: 400, height: 300 });
  open.push(h);
  let list!: Node;
  const rows = new Map<number, Node>();
  const pressed: number[] = [];
  const offsets: ScrollOffset[] = [];
  const [selected, setSelected] = createSignal(0);
  mount(h.ui, () => {
    onKey((e) => {
      if (e.type !== "keyDown") return;
      if (e.key === "j") setSelected((s) => Math.min(messages.length - 1, s + 1));
      if (e.key === "k") setSelected((s) => Math.max(0, s - 1));
    });
    createEffect(() => rows.get(selected())?.scrollIntoView({ block: "nearest" }));
    return (
      <View style={{ flexGrow: 1, minHeight: 0 }}>
        <Scroll ref={list} style={{ flexGrow: 1, minHeight: 0 }} onScroll={(o) => offsets.push(o)}>
          <For each={messages}>
            {(m) => (
              <View ref={(n) => rows.set(m.id, n)} style={{ height: ROW }} onPress={() => pressed.push(m.id)}>
                <Text>{m.subject}</Text>
              </View>
            )}
          </For>
        </Scroll>
      </View>
    );
  });
  h.step();
  return { h, list: () => list, rows, pressed, offsets, setSelected };
}

test("the wheel scrolls in the core: no ops from JS", () => {
  const { h, rows, offsets } = mailbox();
  const commits = h.ui.commits;
  h.wheel(100, 100, 120);
  expect(h.rect(rows.get(0)!)![1]).toBe(-120);
  expect(h.ui.commits).toBe(commits);
  expect(offsets.at(-1)).toEqual({ x: 0, y: 120 });
  h.wheel(100, 100, 1e6);
  expect(offsets.at(-1)).toEqual({ x: 0, y: 50 * ROW - 300 }); // clamped at the end
  expect(h.ui.commits).toBe(commits);
});

test("a press after scrolling reaches the row under the pointer", () => {
  const { h, pressed } = mailbox();
  h.wheel(100, 100, 200);
  h.press([100, 10]);
  expect(pressed).toEqual([5]); // 200 px down: row 5 is at the top
});

test("j/k keep the selection in view with scrollIntoView (nearest)", () => {
  const { h, list } = mailbox();
  for (let i = 0; i < 9; i++) h.key("j");
  expect(list().scrollOffset.y).toBe(10 * ROW - 300); // row 9's bottom at the view's bottom
  for (let i = 0; i < 4; i++) h.key("k"); // back to row 5: still showing, nothing moves
  expect(list().scrollOffset.y).toBe(10 * ROW - 300);
  for (let i = 0; i < 5; i++) h.key("k"); // row 0: scrolled back up
  expect(list().scrollOffset.y).toBe(0);
});

test("scrollTo and scrollBy, from the app", () => {
  const { h, list } = mailbox();
  list().scrollTo({ y: 500 });
  h.step();
  expect(list().scrollOffset.y).toBe(500);
  list().scrollBy({ y: -100 });
  h.step();
  expect(list().scrollOffset.y).toBe(400);
  list().scrollTo({ y: 0 });
  h.step();
  expect(list().scrollOffset.y).toBe(0);
});

test("dragging the thumb scrolls, and the press doesn't reach the row under it", () => {
  const { h, list, pressed } = mailbox();
  // The thumb: 6 px wide, 2 px in from the right edge, at the top of the track.
  const [x, y] = [400 - 2 - 3, 2 + 10];
  h.pointer("down", x, y).pointer("move", x, y + 30).pointer("up", x, y + 30);
  expect(list().scrollOffset.y).toBeGreaterThan(0);
  expect(pressed).toEqual([]);
});

test("a resize keeps the offset within the new limit", () => {
  const { h, list } = mailbox();
  h.wheel(100, 100, 1e6);
  expect(list().scrollOffset.y).toBe(50 * ROW - 300);
  h.resize(400, 500);
  expect(list().scrollOffset.y).toBe(50 * ROW - 500);
});
