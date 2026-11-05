// `mantou dev`'s check (dunkbing/mantou#25), in a real window: runs it on a
// temporary copy of the counter, edits a label, breaks the file and fixes it,
// and reports the time from each save to the app's new frame (the bound is
// generous: CI machines vary; the number is what to watch).
//
//   bun spike/devtest.ts        (on headless Linux: xvfb-run -a bun spike/devtest.ts)
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dir = join(import.meta.dir, `.dev-${process.pid}`); // inside the repo, so `mantou-ui` resolves
const BOUND_MS = 5000;
cpSync(join(root, "examples/counter"), dir, { recursive: true, filter: (p) => !p.endsWith(".test.tsx") });
const counter = join(dir, "Counter.tsx");
const source = readFileSync(counter, "utf8");

const proc = Bun.spawn(["bun", join(root, "runtime/cli.ts"), "dev", join(dir, "main.tsx")], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, MANTOU_DEV_TRACE: "1" } });
const lines: string[] = [];
const pump = async (s: ReadableStream<Uint8Array>) => {
  let rest = "";
  for await (const chunk of s) {
    rest += new TextDecoder().decode(chunk);
    const parts = rest.split("\n");
    rest = parts.pop()!;
    for (const l of parts) {
      lines.push(l);
      console.log(`  | ${l}`);
    }
  }
};
void pump(proc.stdout);
void pump(proc.stderr);

/** Waits for a line matching `re` after line `from`; returns its match and index. */
async function line(re: RegExp, from: number, what: string): Promise<[RegExpMatchArray, number]> {
  for (const giveUp = Date.now() + 30_000; Date.now() < giveUp; ) {
    for (let i = from; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m) return [m, i + 1];
    }
    if (proc.exitCode !== null) throw new Error(`mantou dev exited (${proc.exitCode}) before: ${what}`);
    await Bun.sleep(5);
  }
  throw new Error(`never happened: ${what}`);
}

let failed = false;
const check = (name: string, pass: boolean, detail: string) => {
  failed ||= !pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

try {
  let [m, at] = await line(/started in (\d+) ms .*; (\d+) glyphs/, 0, "the first frame");
  const glyphs = Number(m[2]);
  check("starts", true, `${m[1]} ms to the first frame, ${glyphs} glyphs`);
  [, at] = await line(/warmed the next reload/, at, "the next Worker warmed");

  // A label: "Reset" (5 glyphs) becomes "Start over" (9): the new frame draws 4 more.
  writeFileSync(counter, source.replace(">Reset<", ">Start over<"));
  [m, at] = await line(/reloaded in (\d+) ms .*; (\d+) glyphs/, at, "the reload after the edit");
  check("an edit reloads", Number(m[2]) === glyphs + 4 && Number(m[1]) < BOUND_MS, `${m[1]} ms from the save to the new frame, ${m[2]} glyphs`);

  // A syntax error shows in the window; fixing it reloads.
  writeFileSync(counter, source.replace("export function Counter() {", "export function Counter( {"));
  [, at] = await line(/the app failed to load/, at, "the error");
  check("an error shows", true, "the load error was reported");
  [, at] = await line(/warmed the next reload/, at, "the next Worker warmed");
  writeFileSync(counter, source);
  [m, at] = await line(/reloaded in (\d+) ms .*; (\d+) glyphs/, at, "the reload after the fix");
  check("the fix reloads", Number(m[2]) === glyphs && Number(m[1]) < BOUND_MS, `${m[1]} ms, ${m[2]} glyphs`);
} catch (err) {
  check("mantou dev", false, String(err));
} finally {
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nmantou dev check: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
