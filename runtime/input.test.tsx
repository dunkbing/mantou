// <Input> against the mock core: what it sends, op by op.
import { expect, test } from "bun:test";
import { Input, createSignal, mount, type Node } from "mantou-ui";
import { MockCore } from "./mock";

test("an input is created with its options in one commit", async () => {
  const core = new MockCore();
  mount(core.ui, () => <Input placeholder="Search" multiline readOnly maxLength={10} defaultValue="hi" autoFocus />);
  await core.settle();
  const ops = core.commits[0].filter((o) => o.id === 2);
  expect(ops).toEqual([
    { op: "CREATE", id: 2, kind: 3 },
    { op: "PLACEHOLDER", id: 2, text: "Search" },
    { op: "FOCUS", id: 2 },
    { op: "INPUT_OPTIONS", id: 2, flags: 5, maxLength: 10 },
    { op: "VALUE", id: 2, rev: 0, text: "hi" },
  ]);
});

test("a value set in the same turn as multiline keeps its newlines: options go first", async () => {
  const core = new MockCore();
  const input = core.ui.input();
  input.setValue("a\nb").setValue("one\ntwo").setOptions({ multiline: true });
  await core.settle();
  expect(core.lastCommit.slice(1)).toEqual([
    { op: "INPUT_OPTIONS", id: input.id, flags: 1, maxLength: 0 },
    { op: "VALUE", id: input.id, rev: 0, text: "one\ntwo" },
  ]);
});

test("controlled: the user's change echoes back with no ops; a transform sends one VALUE", async () => {
  const core = new MockCore();
  let input!: Node;
  const [text, setText] = createSignal("");
  const seen: string[] = [];
  mount(core.ui, () => <Input ref={input} value={text()} onChange={(v) => (seen.push(v), setText(v.length > 3 ? v.slice(0, 3) : v))} />);
  await core.settle();
  const commits = core.commits.length;
  core.change(input.id, "abc");
  await core.settle();
  expect(core.commits.length).toBe(commits);
  expect(text()).toBe("abc");
  core.change(input.id, "abcd");
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "VALUE", id: input.id, rev: 2, text: "abc" }]);
  expect(seen).toEqual(["abc", "abcd"]);
});

test("submit, focus and blur reach their handlers", () => {
  const core = new MockCore();
  let input!: Node;
  const log: string[] = [];
  mount(core.ui, () => (
    <Input ref={input} defaultValue="x" onSubmit={(v) => log.push(`submit ${v}`)} onFocus={() => log.push("focus")} onBlur={() => log.push("blur")} />
  ));
  core.focus(input.id);
  expect(input.focused).toBe(true);
  core.submit(input.id);
  core.focus(input.id, false);
  expect(input.focused).toBe(false);
  expect(log).toEqual(["focus", "submit x", "blur"]);
});

test("unknown properties and children are errors", () => {
  const core = new MockCore();
  expect(() => mount(core.ui, () => <Input {...({ bogus: 1 } as object)} />)).toThrow('<Input> has no property "bogus"');
  const input = core.ui.input();
  expect(() => input.append(core.ui.view())).toThrow("no children");
});
