// Single instance: a second launch hands its arguments to the first and exits.
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = "mantou-instance-test-" + process.pid;
function run(...args: string[]) {
  return spawn("tests/fixtures/instance-app.ts", args);
}

// Every copy a test starts is stopped after it, so a failure doesn't leave one holding the lock for the next test.
const started: { kill(): void }[] = [];
afterEach(() => started.splice(0).forEach((p) => p.kill()));

function spawn(file: string, args: string[]) {
  const p = Bun.spawn(["bun", file, ...args], { env: { ...process.env, MANTOU_APP: app }, stdin: "pipe", stdout: "pipe" });
  const out = { text: "" };
  (async () => {
    const dec = new TextDecoder();
    for await (const c of p.stdout) out.text += dec.decode(c);
  })();
  started.push(p);
  return Object.assign(p, { out });
}

async function until(p: { out: { text: string } }, what: string): Promise<string> {
  for (let i = 0; i < 300 && !p.out.text.includes(what); i++) await Bun.sleep(50);
  return p.out.text;
}

test("the second launch exits and the first hears its URL", async () => {
  const first = run("mantou://start");
  expect(await until(first, "first")).toContain("open mantou://start");
  const second = run("mailto:a@b.c");
  expect(await until(second, "second")).toContain("second");
  expect(await second.exited).toBe(0);
  const heard = await until(first, "open mailto:a@b.c");
  expect(heard).toContain("launch mailto:a@b.c");
  first.stdin.write("x");
  await first.exited;
  // the lock outlives the first copy, but is stale: a new copy takes over
  const again = run();
  expect(await until(again, "first")).toContain("first");
  again.stdin.write("x");
  await again.exited;
  rmSync(join(tmpdir(), app), { recursive: true, force: true });
}, 20000);

test("in the app Worker, process.argv has the launch args and onOpen hears them", async () => {
  const first = spawn("tests/fixtures/instance-host.ts", ["mantou://start"]);
  expect(await until(first, "first")).toContain("open mantou://start");
  const second = spawn("tests/fixtures/instance-host.ts", ["mailto:a@b.c"]);
  expect(await until(second, "second")).toContain("second");
  expect(await second.exited).toBe(0);
  const heard = await until(first, "open mailto:a@b.c");
  expect(heard).toContain("launch mailto:a@b.c");
  expect(heard).not.toContain("--width");
  first.stdin.write("x");
  await first.exited;
  rmSync(join(tmpdir(), app), { recursive: true, force: true });
}, 20000);

test("onOpen reports absolute file arguments as they are, from any cwd (#77)", async () => {
  const file = join(tmpdir(), app + "-a.png");
  await Bun.write(file, "x");
  const first = spawn("tests/fixtures/instance-app.ts", [file]);
  expect(await until(first, "open ")).toContain("open " + file);
  first.stdin.write("x");
  await first.exited;
  rmSync(file);
  rmSync(join(tmpdir(), app), { recursive: true, force: true });
}, 20000);
