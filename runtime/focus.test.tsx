import { expect, test } from "bun:test";
import { View, createSignal, mount, type Node } from "mantou-ui";
import { FocusableFlag } from "./gen/protocol";
import { MockCore } from "./mock";

test("focusable and tabIndex are one FOCUSABLE op, sent again only when they change", async () => {
  const core = new MockCore();
  const [index, setIndex] = createSignal<number | undefined>(undefined);
  let a!: Node, b!: Node;
  mount(core.ui, () => (
    <View>
      <View ref={a} focusable tabIndex={index()} />
      <View ref={b} tabIndex={-1} />
      <View />
    </View>
  ));
  await core.settle();
  const ops = core.lastCommit.filter((o) => o.op === "FOCUSABLE");
  expect(ops).toEqual([
    { op: "FOCUSABLE", id: a.id, flags: FocusableFlag.Focusable, order: 0 },
    { op: "FOCUSABLE", id: b.id, flags: FocusableFlag.Focusable | FocusableFlag.SkipTab, order: 0 }, // a tabIndex alone makes it focusable
  ]);
  setIndex(2);
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "FOCUSABLE", id: a.id, flags: FocusableFlag.Focusable, order: 2 }]);
  a.focus();
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "FOCUS", id: a.id }]);
  expect(() => core.ui.view().focus()).toThrow("make this <View> focusable first");
});
