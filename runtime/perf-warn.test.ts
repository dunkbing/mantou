import { expect, test } from "bun:test";
import type { Stats } from "./events";
import { perfWarnings } from "./perf-warn";

const zero: Stats = { frames: 0, commits: 0, wakes: 0, events: 0, resizes: 0, redrawRequests: 0, layouts: 0, ops: 0, opErrors: 0, quads: 0, nodes: 100, presses: 0, glyphs: 0, scenes: 0, textLayouts: 0, applyMicros: 0, layoutMicros: 0, sceneMicros: 0, renderMicros: 0 };

test("a commit every frame is a JS animation", () => {
  const w = perfWarnings(zero, { ...zero, frames: 120, commits: 118 }, 2000);
  expect(w.map((x) => x.kind)).toEqual(["js-animation"]);
  expect(w[0].message).toContain("59 commits a second");
  expect(perfWarnings(zero, { ...zero, frames: 120, commits: 3 }, 2000)).toEqual([]); // the core animating
});

test("slow frames say where the time goes", () => {
  const w = perfWarnings(zero, { ...zero, frames: 20, layoutMicros: 20 * 15_000, sceneMicros: 20 * 2_000 }, 2000);
  expect(w.map((x) => x.kind)).toEqual(["slow-frames"]);
  expect(w[0].message).toContain("layout 15.0, scene 2.0");
});

test("op errors and huge trees", () => {
  expect(perfWarnings(zero, { ...zero, opErrors: 2 }, 2000).map((x) => x.kind)).toEqual(["op-errors"]);
  expect(perfWarnings(zero, { ...zero, nodes: 25_000 }, 2000).map((x) => x.kind)).toEqual(["many-nodes"]);
});
