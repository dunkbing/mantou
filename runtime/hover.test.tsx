import { expect, test } from "bun:test";
import { Input, View, mount, type Node } from "mantou-ui";
import { EventMask } from "./gen/protocol";
import { MockCore } from "./mock";

test("hover handlers turn the Hover listen bit on and off; the cursor is a style", async () => {
  const core = new MockCore();
  let node!: Node;
  const seen: boolean[] = [];
  mount(core.ui, () => <View ref={node} onHover={(h) => seen.push(h)} style={{ cursor: "pointer" }} />);
  await core.settle();
  expect(core.lastCommit.find((o) => o.op === "LISTEN")?.mask).toBe(EventMask.Hover);
  expect(core.lastCommit.find((o) => o.op === "STYLE")).toMatchObject({ prop: "cursor", value: "pointer" });
  core.hover(node.id);
  core.hover(node.id); // the same state twice: heard once
  core.hover(node.id, false);
  expect(seen).toEqual([true, false]);
  const off = node.onHover(() => {});
  off();
  await core.settle();
  expect(core.commits.length).toBe(1); // a second handler coming and going sends nothing
});

test("setSelection is sent after the turn's value", async () => {
  const core = new MockCore();
  let input!: Node;
  mount(core.ui, () => <Input ref={input} />);
  await core.settle();
  input.setSelection(3, 1);
  input.setValue("hello");
  await core.settle();
  expect(core.lastCommit.map((o) => [o.op, o.anchor ?? o.text, o.focus])).toEqual([["VALUE", "hello", undefined], ["SELECT", 3, 1]]);
  expect(input.selection()).toBeNull(); // no core
  expect(() => input.setSelection(-1)).toThrow("0 or more");
});
