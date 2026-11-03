// The counter against the mock core: what it sends, op by op.
import { expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { MockCore } from "../../runtime/mock";
import { Counter } from "./Counter";

function setup() {
  const core = new MockCore();
  const dispose = mount(core.ui, () => <Counter />);
  return { core, dispose };
}

/** The buttons, in order: the nodes that listen for presses in the first commit. */
function buttons(core: MockCore): number[] {
  return core.commits[0].filter((o) => o.op === "LISTEN").map((o) => o.id as number);
}

test("the first commit builds the whole tree in one batch", async () => {
  const { core } = setup();
  await core.settle();
  expect(core.commits.length).toBe(1);
  const ops = core.commits[0].map((o) => o.op);
  expect(ops.filter((o) => o === "CREATE").length).toBe(11); // root, 6 views, 4 texts
  expect(ops.filter((o) => o === "STYLE_DEF").length).toBe(2); // `button` and `label`; `dot` isn't used yet
  expect(core.commits[0].filter((o) => o.op === "TEXT").map((o) => o.text)).toEqual(["+1", "−1", "Reset", "0"]);
  expect(ops).toContain("SET_ROOT");
  expect(buttons(core).length).toBe(3);
});

test("pressing + adds one square and updates the count: 5 ops in one commit", async () => {
  const { core } = setup();
  await core.settle();
  const [plus] = buttons(core);
  core.press(plus);
  await core.settle();
  expect(core.commits.length).toBe(2);
  const ops = core.lastCommit.map((o) => o.op);
  // The first square also defines the `dot` style.
  expect(ops.sort()).toEqual(["CREATE", "INSERT", "STYLE_DEF", "STYLE_USE", "TEXT", "TITLE"]);
  core.press(plus);
  await core.settle();
  expect(core.lastCommit.map((o) => o.op).sort()).toEqual(["CREATE", "INSERT", "STYLE_USE", "TEXT", "TITLE"]);
  expect(core.lastCommit.find((o) => o.op === "TEXT")).toMatchObject({ text: "2" });
  expect(core.lastCommit.find((o) => o.op === "TITLE")).toMatchObject({ title: "Mantou counter · 2" });
});

test("pressing − releases the last square; ⟲ releases them all", async () => {
  const { core } = setup();
  await core.settle();
  const [plus, minus, reset] = buttons(core);
  for (let i = 0; i < 3; i++) core.press(plus);
  await core.settle();
  core.press(minus);
  await core.settle();
  expect(core.lastCommit.map((o) => o.op).sort()).toEqual(["RELEASE", "TEXT", "TITLE"]);
  core.press(reset);
  await core.settle();
  expect(core.lastCommit.filter((o) => o.op === "RELEASE").length).toBe(2);
});

test("several presses in one turn are one commit", async () => {
  const { core } = setup();
  await core.settle();
  const [plus] = buttons(core);
  for (let i = 0; i < 5; i++) core.press(plus);
  await core.settle();
  expect(core.commits.length).toBe(2);
  expect(core.lastCommit.filter((o) => o.op === "CREATE").length).toBe(5);
});

test("disposing releases every node and clears the root", async () => {
  const { core, dispose } = setup();
  await core.settle();
  core.press(buttons(core)[0]);
  await core.settle();
  dispose();
  await core.settle();
  expect(core.ui.nodes.size).toBe(0);
  expect(core.lastCommit.find((o) => o.op === "SET_ROOT")).toMatchObject({ id: 0 });
});

test("keys change the count", async () => {
  const { core } = setup();
  await core.settle();
  const key = (k: string) => core.ui.dispatchKey({ type: "keyDown", key: k, shift: false, ctrl: false, alt: false, meta: false });
  key("+");
  key("ArrowUp");
  key("-");
  await core.settle();
  expect(core.lastCommit.find((o) => o.op === "TEXT")).toMatchObject({ text: "1" });
});
