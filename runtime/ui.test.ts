import { expect, test } from "bun:test";
import { decodeOps } from "./decode";
import { OpEncoder } from "./encoder";
import { MockCore } from "./mock";
import { parseColor, formatColor } from "./style";

test("encoder → decoder round trip for every value kind", () => {
  const e = new OpEncoder();
  e.create(7, 1);
  e.style(7, "width", 24);
  e.style(7, "height", "50%");
  e.style(7, "minWidth", "auto");
  e.style(7, "backgroundColor", "#0af");
  e.style(7, "flexDirection", "rowReverse");
  e.style(7, "opacity", 0.25);
  e.title("héllo");
  expect(decodeOps(e.take())).toEqual([
    { op: "CREATE", id: 7, kind: 1 },
    { op: "STYLE", id: 7, prop: "width", value: 24 },
    { op: "STYLE", id: 7, prop: "height", value: "50%" },
    { op: "STYLE", id: 7, prop: "minWidth", value: "auto" },
    { op: "STYLE", id: 7, prop: "backgroundColor", value: "#00aaffff" },
    { op: "STYLE", id: 7, prop: "flexDirection", value: "rowReverse" },
    { op: "STYLE", id: 7, prop: "opacity", value: 0.25 },
    { op: "TITLE", title: "héllo" },
  ]);
});

test("colours", () => {
  expect(formatColor(parseColor("#f59e0b"))).toBe("#f59e0bff");
  expect(formatColor(parseColor("#f59e0b80"))).toBe("#f59e0b80");
  expect(formatColor(parseColor([255, 0, 0, 0.5]))).toBe("#ff000080");
  expect(parseColor("transparent")).toBe(0);
  expect(() => parseColor("red")).toThrow(/unsupported colour/);
});

test("invalid styles throw where they are written", () => {
  const core = new MockCore();
  const v = core.ui.view();
  expect(() => v.style({ width: "wide" as never })).toThrow(/width must be/);
  expect(() => v.style({ flexDirection: "diagonal" as never })).toThrow(/flexDirection must be one of/);
  expect(() => v.style({ colour: "#fff" } as never)).toThrow(/unknown style property/);
});

test("unchanged style values send nothing; undefined resets", async () => {
  const core = new MockCore();
  const v = core.ui.view({ width: 10, padding: 4 });
  await core.settle();
  v.style({ width: 10, padding: 4 });
  await core.settle();
  expect(core.commits.length).toBe(1);
  v.style({ width: undefined });
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "STYLE_RESET", id: v.id, prop: "width" }]);
});

test("an insert that changes nothing sends nothing; a move sends one op", async () => {
  const core = new MockCore();
  const ui = core.ui;
  const p = ui.view(), a = ui.view(), b = ui.view();
  p.append(a).append(b);
  await core.settle();
  p.append(b);
  p.insertBefore(a, b);
  await core.settle();
  expect(core.commits.length).toBe(1);
  p.insertBefore(b, a);
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "INSERT", parent: p.id, child: b.id, before: a.id }]);
  expect(p.children.map((c) => c.id)).toEqual([b.id, a.id]);
});

test("presses bubble to ancestors until stopped", async () => {
  const core = new MockCore();
  const ui = core.ui;
  const outer = ui.view(), inner = ui.view(), leaf = ui.view();
  outer.append(inner);
  inner.append(leaf);
  const seen: string[] = [];
  outer.onPress(() => seen.push("outer"));
  inner.onPress((e) => {
    seen.push(`inner:${e.target.id === leaf.id}`);
  });
  core.press(leaf.id);
  expect(seen).toEqual(["inner:true", "outer"]);
  seen.length = 0;
  inner.onPress((e) => e.stopPropagation());
  core.press(leaf.id);
  expect(seen).toEqual(["inner:true"]);
});

test("listening is sent once per change of interest", async () => {
  const core = new MockCore();
  const v = core.ui.view();
  await core.settle();
  const off1 = v.onPress(() => {});
  const off2 = v.onPress(() => {});
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "LISTEN", id: v.id, mask: 1 }]);
  off1();
  off2();
  await core.settle();
  expect(core.lastCommit).toEqual([{ op: "LISTEN", id: v.id, mask: 0 }]);
});

test("released nodes refuse further use", () => {
  const core = new MockCore();
  const v = core.ui.view();
  v.release();
  expect(() => v.style({ width: 1 })).toThrow(/released/);
});
