import { expect, test } from "bun:test";
import { View, createSignal, mount, type Node } from "mantou-ui";
import { Easing } from "./gen/protocol";
import { MockCore } from "./mock";

test("the transition prop sends a TRANSITION per property, and only changes after", async () => {
  const core = new MockCore();
  const [fast, setFast] = createSignal(false);
  const [x, setX] = createSignal(0);
  mount(core.ui, () => (
    <View transition={fast() ? { translateX: 100 } : { translateX: 300, opacity: { duration: 200, easing: "linear" } }} style={{ translateX: x() }} />
  ));
  await core.settle();
  expect(core.lastCommit.filter((o) => o.op === "TRANSITION").map((o) => [o.prop, o.duration, o.easing])).toEqual([
    ["translateX", 300, Easing.Ease], ["opacity", 200, Easing.Linear],
  ]);
  setX(50);
  await core.settle();
  expect(core.lastCommit.map((o) => o.op)).toEqual(["STYLE"]); // the core animates it: one op
  setFast(true);
  await core.settle();
  expect(core.lastCommit.map((o) => [o.op, o.prop, o.duration])).toEqual([
    ["TRANSITION", "translateX", 100], ["TRANSITION", "opacity", 0], // left out: off
  ]);
});

test("animate() sends one ANIMATE; it settles on ANIMATION_END or when the node goes", async () => {
  const core = new MockCore();
  let node!: Node;
  mount(core.ui, () => <View ref={node} />);
  await core.settle();
  const a = node.animate("backgroundColor", { from: "#ff0000", to: "#0000ff", duration: 500, iterations: Infinity, alternate: true });
  await core.settle();
  const op = core.lastCommit[0];
  expect(op).toMatchObject({ op: "ANIMATE", id: node.id, prop: "backgroundColor", from: 0xff0000ff, to: 0xffff0000, duration: 500, iterations: Infinity, flags: 1 });
  let ended = false;
  a.finished.then(() => (ended = true));
  core.animationEnd(op.animation as number);
  await a.finished;
  expect(ended).toBe(true);

  const b = node.animate("scale", { from: 1, to: 2, duration: 100 });
  b.stop();
  await core.settle();
  expect(core.lastCommit.map((o) => [o.op, o.duration])).toEqual([["ANIMATE", 100], ["ANIMATE", 0]]);
  node.release();
  await b.finished;
  expect(core.ui.animations.size).toBe(0);
});

test("only animatable properties, with known easings", () => {
  const core = new MockCore();
  const node = core.ui.view();
  expect(() => node.transition({ width: 100 } as never)).toThrow("can't be animated");
  expect(() => node.animate("opacity", { from: 0, to: 1, duration: 100, easing: "bounce" as never })).toThrow("unknown easing");
  expect(() => node.animate("opacity", { from: "#fff", to: 1, duration: 100 })).toThrow("must be numbers");
});
