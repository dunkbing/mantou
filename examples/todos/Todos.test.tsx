// The to-do list on the real core, headless: type, press Enter, tick off.
import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "../../runtime/headless";
import { Todos } from "./Todos";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function todos() {
  const h = new HeadlessCore({ width: 420, height: 520 });
  open.push(h);
  mount(h.ui, () => <Todos />);
  return h.step();
}

const text = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isText).map((n) => n.textContent);

test("the field has the focus; Enter adds the item and clears the field", () => {
  const h = todos();
  const field = h.focused()!;
  expect(field.isInput).toBe(true);
  h.type("Buy rice\n");
  h.type("  \n"); // blank: not added
  h.type("Call Ana\n");
  expect(text(h)).toContain("Buy rice");
  expect(text(h)).toContain("Call Ana");
  expect(text(h)).toContain("2 left");
  expect(h.value(field)).toBe("");
});

test("pressing an item ticks it off", () => {
  const h = todos();
  h.type("Buy rice\n");
  const item = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === "Buy rice")!;
  h.press(item);
  expect(text(h)).toContain("0 left");
  expect(h.focused()).toBeNull(); // pressing outside the field blurs it
});

test("Tab goes to the notes, which take several lines", () => {
  const h = todos();
  h.key("Tab").type("one\ntwo");
  const notes = h.focused()!;
  expect(h.value(notes)).toBe("one\ntwo");
});

test("a screen reader sees a form and a list of checkboxes, and a tick changes one state", () => {
  const h = todos();
  h.type("Buy rice\n");
  h.type("Call Ana\n");
  const tree = () => h.accessibility().split("\n").map((l) => l.trim()).filter(Boolean);
  expect(tree()).toContain('TextInput "New to-do" value=""');
  expect(tree()).toContain('CheckBox "Buy rice" False');
  expect(tree()).toContain('CheckBox "Call Ana" False');
  expect(tree()).toContain('Status "2 left"');
  h.press([...h.ui.nodes.values()].find((n) => n.isText && n.textContent === "Buy rice")!);
  expect(tree()).toContain('CheckBox "Buy rice" True');
  expect(tree()).toContain('CheckBox "Call Ana" False');
  expect(tree()).toContain('Status "1 left"');
});
