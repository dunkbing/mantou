// Focusable views on the real core, headless (dunkbing/mantou#17): Tab into
// buttons and a list, Enter and Space press, the list pages with the keys,
// keys reach the focused view first, and the ring in a reference image.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { For, Input, Scroll, Text, View, mount, onKey, type JSX, type KeyEvent, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element, size = { width: 400, height: 300 }, scale = 1) {
  const h = new HeadlessCore({ ...size, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("Tab reaches buttons and inputs; Enter and Space press a focused button", () => {
  let save!: Node, cancel!: Node, name!: Node;
  const log: string[] = [];
  const h = app(() => (
    <View style={{ padding: 10, gap: 8, alignItems: "start" }}>
      <Input ref={name} style={{ width: 200, height: 28 }} />
      <View ref={save} focusable onPress={() => log.push("save")} onFocus={() => log.push("focus save")} onBlur={() => log.push("blur save")} style={{ width: 80, height: 30 }} />
      <View ref={cancel} focusable onPress={() => log.push("cancel")} style={{ width: 80, height: 30 }} />
    </View>
  ));
  h.key("Tab");
  expect(h.focused()).toBe(name);
  h.key("Tab");
  expect(h.focused()).toBe(save);
  h.key("Enter");
  h.key(" ");
  h.key("Tab");
  expect(h.focused()).toBe(cancel);
  h.key("Enter");
  expect(log).toEqual(["focus save", "save", "save", "blur save", "cancel"]);
  // A press focuses it too, and nothing else happens to the focus.
  h.press(save);
  expect(h.focused()).toBe(save);
});

test("a list you can tab into and page through", () => {
  let list!: Node;
  const h = app(() => (
    <View style={{ flexGrow: 1, minHeight: 0 }}>
      <Scroll ref={list} focusable onScroll={() => {}} style={{ flexGrow: 1, minHeight: 0 }}>
        <For each={Array.from({ length: 50 }, (_, i) => i)}>{(i) => <View style={{ height: 40, flexShrink: 0 }}><Text>{`Row ${i}`}</Text></View>}</For>
      </Scroll>
    </View>
  ));
  h.key("Tab");
  expect(h.focused()).toBe(list);
  const commits = h.ui.commits;
  h.key("PageDown");
  expect(list.scrollOffset.y).toBe(270); // 90% of the 300 px view
  h.key("ArrowDown");
  expect(list.scrollOffset.y).toBe(310);
  h.key("End");
  expect(list.scrollOffset.y).toBe(50 * 40 - 300);
  h.key(" ", { shift: true });
  expect(list.scrollOffset.y).toBe(50 * 40 - 300 - 270);
  h.key("Home");
  expect(list.scrollOffset.y).toBe(0);
  expect(h.ui.commits).toBe(commits); // the core scrolled; JS sent nothing
});

test("keys reach the focused view first, then bubble, then the window", () => {
  let row!: Node;
  const log: string[] = [];
  const h = app(() => {
    const down = (who: string) => (e: KeyEvent) => e.type === "keyDown" && log.push(`${who} ${e.key}`);
    onKey(down("window"));
    return (
      <View onKey={down("list")}>
        <View ref={row} focusable onKey={(e) => { down("row")(e); if (e.key === "x") e.stopPropagation?.(); }} style={{ height: 40 }} />
      </View>
    );
  });
  h.key("j");
  expect(log).toEqual(["window j"]); // nothing focused
  h.press(row);
  log.length = 0;
  h.key("j");
  h.key("x");
  expect(log).toEqual(["row j", "list j", "window j", "row x"]);
});

test("the focus ring at 1× and 2×, only from the keyboard", () => {
  for (const scale of [1, 2]) {
    let b!: Node;
    const h = app(
      () => (
        <View style={{ flexGrow: 1, padding: 20, gap: 16, flexDirection: "row", alignItems: "start", backgroundColor: "#ffffff" }}>
          <View ref={b} focusable onPress={() => {}} style={{ width: 90, height: 36, borderRadius: 8, backgroundColor: "#2563eb", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", textAlign: "center" }}>Save</Text>
          </View>
          <View focusable style={{ width: 90, height: 36, borderRadius: 18, backgroundColor: "#e5e7eb", focusRingColor: "#16a34a", focusRingOffset: 4 }} />
        </View>
      ),
      { width: 260, height: 80 },
      scale,
    );
    h.press(b);
    const pressed = h.capture();
    h.key("Tab", { shift: true });
    h.key("Tab");
    expect(h.focused()).toBe(b);
    expect(h.capture()).toMatchImage(`focus@${scale}x`);
    h.key("Tab");
    expect(pressed).toMatchImage(`focus-pressed@${scale}x`); // focused by a press: no ring
  }
});
