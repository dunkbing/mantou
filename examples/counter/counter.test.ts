import { expect, test } from "bun:test";
import { MockCore } from "../../runtime/mock";
import { counter } from "./counter";

test("the first commit builds the whole tree in one batch", async () => {
  const core = new MockCore();
  counter(core.ui);
  await core.settle();
  expect(core.commits.length).toBe(1);
  const ops = core.lastCommit.map((o) => o.op);
  expect(ops.filter((o) => o === "CREATE").length).toBe(6);
  expect(ops).toContain("SET_ROOT");
  expect(ops.filter((o) => o === "STYLE_DEF").length).toBe(2);
});

test("pressing + adds a square with 4 ops: CREATE, STYLE_USE, INSERT, TITLE", async () => {
  const core = new MockCore();
  const c = counter(core.ui);
  await core.settle();
  core.press(c.plus.id);
  await core.settle();
  expect(core.commits.length).toBe(2);
  expect(core.lastCommit.map((o) => o.op)).toEqual(["CREATE", "STYLE_USE", "INSERT", "TITLE"]);
  expect(core.lastCommit[2]).toMatchObject({ parent: c.board.id, before: 0 });
  expect(c.count()).toBe(1);
});

test("pressing − releases the last square (the core detaches it)", async () => {
  const core = new MockCore();
  const c = counter(core.ui);
  core.press(c.plus.id);
  core.press(c.plus.id);
  await core.settle();
  core.press(c.minus.id);
  await core.settle();
  expect(core.lastCommit.map((o) => o.op)).toEqual(["RELEASE", "TITLE"]);
  expect(c.count()).toBe(1);
  expect(c.board.children.length).toBe(1);
});

test("several presses in one turn are one commit", async () => {
  const core = new MockCore();
  const c = counter(core.ui);
  await core.settle();
  for (let i = 0; i < 5; i++) core.press(c.plus.id);
  await core.settle();
  expect(core.commits.length).toBe(2);
  expect(core.lastCommit.filter((o) => o.op === "CREATE").length).toBe(5);
});

test("released ids are reused", async () => {
  const core = new MockCore();
  const c = counter(core.ui);
  core.press(c.plus.id);
  await core.settle();
  const id = c.board.children[0].id;
  core.press(c.minus.id);
  core.press(c.plus.id);
  await core.settle();
  expect(c.board.children[0].id).toBe(id);
  expect(core.lastCommit.map((o) => o.op)).toEqual(["RELEASE", "TITLE", "CREATE", "STYLE_USE", "INSERT", "TITLE"]);
});
