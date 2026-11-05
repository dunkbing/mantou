// Crash reports (dunkbing/mantou#62), on the real core, headless: a panic the
// core recovers from leaves a report and reaches `onError`; the app runs on.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Text, View, createSignal, mount, onError, type AppError, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
const cleanup: (() => void)[] = [];
afterEach(() => {
  open.splice(0).forEach((h) => h.free());
  cleanup.splice(0).forEach((f) => f());
});

function crashDir(h: HeadlessCore, dir: string) {
  const b = new TextEncoder().encode(dir);
  h.lib.symbols.mt_set_crash_dir(b, b.byteLength);
  cleanup.push(() => h.lib.symbols.mt_set_crash_dir(null, 0));
}

test("a core panic writes a report, reaches onError, and the instance runs on", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-crash-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const h = new HeadlessCore({ width: 200, height: 100 });
  open.push(h);
  crashDir(h, join(dir, "crashes"));
  const seen: AppError[] = [];
  cleanup.push(onError((e) => void seen.push(e)));
  let label!: Node;
  const [text, setText] = createSignal("Still here");
  mount(h.ui, () => <View style={{ padding: 8 }}><Text ref={label}>{text()}</Text></View>);
  h.step();

  h.lib.symbols.mt_test_panic(h.handle);
  h.step();
  expect(h.received.coreError).toBe(1);
  expect(seen).toHaveLength(1);
  expect(seen[0].kind).toBe("core");
  expect(seen[0].message).toBe("test panic");
  const files = readdirSync(join(dir, "crashes"));
  expect(files).toHaveLength(1);
  expect(seen[0].report).toBe(join(dir, "crashes", files[0]));
  const report = readFileSync(seen[0].report!, "utf8");
  expect(report).toContain("message: test panic");
  expect(report).toContain(`os: ${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform}-`);
  expect(report).toMatch(/backtrace:/);

  // The instance still works.
  setText("Changed");
  h.step();
  expect(h.rect(label)).toBeTruthy();
  expect(h.scene()).toMatch(/glyphs 7/);
});

test("without a crash folder, a recovered panic still reaches onError, with no report", () => {
  const h = new HeadlessCore({ width: 200, height: 100 });
  open.push(h);
  crashDir(h, "");
  const seen: AppError[] = [];
  cleanup.push(onError((e) => void seen.push(e)));
  h.lib.symbols.mt_test_panic(h.handle);
  h.step();
  expect(seen.map((e) => [e.kind, e.message, e.report])).toEqual([["core", "test panic", undefined]]);
});
