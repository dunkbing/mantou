// `mantou snap`: an app run headless from the command line, with scenes, scripted input and checks.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../runtime/png";

const cli = join(import.meta.dir, "..", "runtime", "cli.ts");
const app = join(import.meta.dir, "apps", "snap-app.tsx");
const dir = mkdtempSync(join(tmpdir(), "mantou-snap-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function snap(...args: string[]) {
  const p = Bun.spawnSync([process.execPath, cli, "snap", app, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

test("it prints the tree, writes a screenshot and the tree as JSON", () => {
  const png = join(dir, "a.png"), json = join(dir, "a.json");
  const r = snap("--script", '[{"press":"add"}]', "--out", png, "--tree", json, "--scale", "1");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/Text#\d+ \[count\] "3 items"/);
  expect(r.out).toMatch(/\[add\] 16,\d+ 80×32 role=button label="Add"/);
  const img = decodePng(new Uint8Array(readFileSync(png)));
  expect([img.width, img.height]).toEqual([300, 220]);
  const tree = JSON.parse(readFileSync(json, "utf8"));
  expect(tree.kind).toBe("View");
}, 60_000);

test("scenes set the app's state first; --list-scenes names them", () => {
  expect(snap("--list-scenes").out.trim().split("\n")).toEqual(["empty", "loading"]);
  expect(snap("--scene", "empty").out).toMatch(/"0 items"/);
  const missing = snap("--scene", "nope");
  expect(missing.code).toBe(1);
  expect(missing.err).toContain('no scene "nope" (there are: empty, loading)');
}, 60_000);

test("a missing target fails with the testIds there are", () => {
  const r = snap("--script", '[{"press":"save"}]');
  expect(r.code).toBe(1);
  expect(r.err).toContain('no node with testId "save" (there are: "count", "add")');
}, 60_000);

test("--check-motion fails on an endless animation unless it's allowed", () => {
  const r = snap("--scene", "loading", "--quiet", "--check-motion", "300");
  expect(r.code).toBe(1);
  expect(r.out).toContain("motion: never-settles spinner");
  expect(snap("--scene", "loading", "--quiet", "--check-motion", "300", "--allow", "spinner").code).toBe(0);
}, 60_000);

test.if(process.platform === "linux")("on Linux, the desktop's colour scheme reaches useColorScheme (dunkbing/mantou#79)", () => {
  const app = join(import.meta.dir, "apps", "scheme-app.tsx");
  const run = (scheme: string) => Bun.spawnSync([process.execPath, cli, "snap", app], { env: { ...process.env, MANTOU_COLOR_SCHEME: scheme }, stdout: "pipe" }).stdout.toString();
  expect(run("dark")).toContain('[scheme] "dark"');
  expect(run("light")).toContain('[scheme] "light"');
}, 60_000);
