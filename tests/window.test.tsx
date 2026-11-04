// The app sizes its window (dunkbing/mantou#29). A headless instance has no
// window: a size the app asks for resizes its viewport, so the app's layout
// and useWindowSize follow, as they would in a window.
import { afterEach, expect, test } from "bun:test";
import { View, createEffect, mount, useWindowSize, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { MockCore } from "../runtime/mock";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("setWindowSize resizes; the layout and useWindowSize follow", () => {
  const h = new HeadlessCore({ width: 640, height: 400, scale: 2 });
  open.push(h);
  let root!: Node;
  const sizes: string[] = [];
  mount(h.ui, () => {
    const size = useWindowSize();
    createEffect(() => sizes.push(`${size().width}x${size().height}`));
    return <View ref={root} style={{ flexGrow: 1 }} />;
  });
  h.step();
  h.ui.setWindowSize({ width: 1200, height: 760 });
  h.step();
  expect(h.rect(root)).toEqual([0, 0, 1200, 760]);
  expect(sizes).toEqual(["640x400", "1200x760"]);
});

test("the ops: a size, and limits with resizable", async () => {
  const core = new MockCore();
  core.ui.setWindowSize({ width: 1200, height: 760 });
  core.ui.setWindowLimits({ minWidth: 900, minHeight: 560, resizable: false });
  await core.settle();
  expect(core.lastCommit).toEqual([
    { op: "WINDOW_SIZE", width: 1200, height: 760 },
    { op: "WINDOW_LIMITS", minWidth: 900, minHeight: 560, maxWidth: 0, maxHeight: 0, flags: 1 },
  ]);
});
