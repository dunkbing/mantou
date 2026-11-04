// dumpTree prints the tree with the core's boxes.
import { afterEach, expect, test } from "bun:test";
import { Text, View, dumpTree, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("dumpTree lists the nodes, their boxes and their text", () => {
  const h = new HeadlessCore({ width: 300, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <View style={{ width: 120, height: 60, padding: 10 }}>
      <Text>Hello</Text>
    </View>
  ));
  h.step();
  const lines = dumpTree().split("\n");
  expect(lines.some((l) => /^\s*View#\d+ 0,0 120×60$/.test(l))).toBe(true);
  expect(lines.some((l) => /^\s*Text#\d+ 10,10 .*"Hello"$/.test(l))).toBe(true);
});
