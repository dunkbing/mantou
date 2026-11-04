// Hover and cursors on the real core, headless (dunkbing/mantou#18): the
// core tracks the pointer, tells hover handlers, and picks the cursor.
import { afterEach, expect, test } from "bun:test";
import { For, Input, Scroll, Show, Text, View, createSignal, mount, type JSX, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element) {
  const h = new HeadlessCore({ width: 400, height: 300 });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("a button highlights under the pointer, with one style op each way", () => {
  let button!: Node;
  const log: string[] = [];
  const [hot, setHot] = createSignal(false);
  const h = app(() => (
    <View style={{ padding: 20 }}>
      <View
        ref={button}
        onHover={setHot}
        onPointerEnter={() => log.push("enter")}
        onPointerLeave={() => log.push("leave")}
        style={{ width: 100, height: 40, cursor: "pointer", backgroundColor: hot() ? "#1d4ed8" : "#2563eb" }}
      >
        <Text>Save</Text>
      </View>
    </View>
  ));
  expect(h.cursor()).toBe("default");
  h.hover(button);
  expect(hot()).toBe(true);
  expect(button.hovered).toBe(true);
  expect(h.ui.lastCommitOps).toBe(1); // the background
  expect(h.cursor()).toBe("pointer");
  h.hover([60, 30]); // over its text: still inside
  expect(log).toEqual(["enter"]);
  h.hover([300, 200]);
  expect(hot()).toBe(false);
  expect(log).toEqual(["enter", "leave"]);
  expect(h.cursor()).toBe("default");
  h.hover(button);
  h.unhover(); // out of the window
  expect(log).toEqual(["enter", "leave", "enter", "leave"]);
});

test("rows hover as a list scrolls under a still pointer; inputs show the text cursor", () => {
  const [hot, setHot] = createSignal(-1);
  let list!: Node, input!: Node;
  const h = app(() => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <Input ref={input} style={{ height: 30 }} />
      <Scroll ref={list} style={{ height: 120 }}>
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
          {(i) => <View onHover={(on) => on ? setHot(i) : hot() === i && setHot(-1)} style={{ height: 40, flexShrink: 0 }} />}
        </For>
      </Scroll>
    </View>
  ));
  h.hover([50, 50]);
  expect(hot()).toBe(0);
  h.wheel(50, 50, 80);
  expect(hot()).toBe(2);
  h.hover([50, 10]);
  expect(hot()).toBe(-1);
  expect(h.cursor()).toBe("text");
  expect(input.hovered).toBe(false); // no handler: not tracked
});

test("a node removed from under the pointer is left; a new one there is entered", () => {
  const [shown, setShown] = createSignal(true);
  const log: string[] = [];
  const h = app(() => (
    <View>
      <Show when={shown()} fallback={<View onHover={(on) => log.push(`b ${on}`)} style={{ height: 50 }} />}>
        <View onHover={(on) => log.push(`a ${on}`)} style={{ height: 50 }} />
      </Show>
    </View>
  ));
  h.hover([10, 10]);
  setShown(false);
  h.step();
  expect(log).toEqual(["a true", "b true"]); // a was released: its handlers are gone with it
});
