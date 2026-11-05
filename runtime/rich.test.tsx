import { expect, test } from "bun:test";
import { Show, Text, createSignal, mount } from "mantou-ui";
import { MockCore } from "./mock";

test("spans are one TEXT and one TEXT_RUNS on the outer Text, never inserted", async () => {
  const core = new MockCore();
  const [name, setName] = createSignal("Alice");
  mount(core.ui, () => (
    <Text>
      From <Text style={{ fontWeight: 700 }}>{name()}</Text>: the <Text style={{ backgroundColor: "#fde047" }}>invoice</Text> is ready
    </Text>
  ));
  await core.settle();
  const ops = core.lastCommit;
  expect(ops.filter((o) => o.op === "INSERT").length).toBe(1); // only the outer Text, into the root
  const text = ops.find((o) => o.op === "TEXT")!;
  expect(text.text).toBe("From Alice: the invoice is ready");
  const runs = ops.find((o) => o.op === "TEXT_RUNS")!;
  const [bold, mark] = ops.filter((o) => o.op === "CREATE" && o.id !== text.id && o.kind === 2).map((o) => o.id as number);
  expect(runs).toMatchObject({ id: text.id, runs: [{ length: 5, spans: [] }, { length: 5, spans: [bold] }, { length: 6, spans: [] }, { length: 7, spans: [mark] }, { length: 9, spans: [] }] });
  // New text in a span: the outer Text's text and runs again, and nothing else.
  setName("Zoë");
  await core.settle();
  expect(core.lastCommit.map((o) => o.op)).toEqual(["TEXT", "TEXT_RUNS"]);
  expect((core.lastCommit[1].runs as unknown[])[1]).toEqual({ length: 4, spans: [bold] }); // "Zoë" is 4 bytes
});

test("a span's style is its own STYLE op; a span that goes takes its run with it", async () => {
  const core = new MockCore();
  const [hot, setHot] = createSignal(false);
  const [shown, setShown] = createSignal(true);
  mount(core.ui, () => (
    <Text>
      a<Show when={shown()}><Text style={{ color: hot() ? "#ff0000" : "#000000" }}>b</Text></Show>c
    </Text>
  ));
  await core.settle();
  setHot(true);
  await core.settle();
  expect(core.lastCommit.map((o) => [o.op, o.prop])).toEqual([["STYLE", "color"]]); // the core redraws the run
  setShown(false);
  await core.settle();
  expect(core.lastCommit.map((o) => o.op)).toEqual(["RELEASE", "TEXT", "TEXT_RUNS"]);
  expect(core.lastCommit[2].runs).toEqual([]); // plain again
});

test("views can't go inside a Text", () => {
  const core = new MockCore();
  const t = core.ui.textNode();
  expect(() => t.append(core.ui.view())).toThrow("only text and <Text> spans");
});
