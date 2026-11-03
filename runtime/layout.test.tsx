// onLayout and useWindowSize against the mock core: what they send.
import { expect, test } from "bun:test";
import { View, createEffect, mount, useWindowSize, type Node } from "mantou-ui";
import { MockCore } from "./mock";

test("onLayout and onPress share one LISTEN, with both bits", async () => {
  const core = new MockCore();
  let v!: Node;
  mount(core.ui, () => <View ref={v} onPress={() => {}} onLayout={() => {}} />);
  await core.settle();
  expect(core.commits[0].filter((o) => o.op === "LISTEN" && o.id === v.id).at(-1)).toEqual({ op: "LISTEN", id: v.id, mask: 3 });
});

test("a layout event reaches the handler and is kept on the node", () => {
  const core = new MockCore();
  let v!: Node;
  const got: number[] = [];
  mount(core.ui, () => <View ref={v} onLayout={(r) => got.push(r.width)} />);
  core.layout(v.id, { x: 0, y: 0, width: 120, height: 40 });
  expect(got).toEqual([120]);
  expect(v.layout).toEqual({ x: 0, y: 0, width: 120, height: 40 });
});

test("useWindowSize reads 0 × 0 until the window reports a size", () => {
  const core = new MockCore();
  const seen: number[] = [];
  mount(core.ui, () => {
    const size = useWindowSize();
    createEffect(() => seen.push(size().width));
    return <View />;
  });
  core.resize(800, 600);
  core.resize(800, 600); // unchanged: no update
  expect(seen).toEqual([0, 800]);
});
