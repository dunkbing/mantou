// An app that quits before it's ready (a second launch handing off to the first) ends the process at once,
// with its exit code, instead of the bootstrap waiting for it (dunkbing/mantou#84).
import { expect, test } from "bun:test";
import { join } from "node:path";

const main = join(import.meta.dir, "..", "runtime", "main.ts");
const app = join(import.meta.dir, "apps", "exit-early.ts");

test("the process exits with the app's code when it quits before showing a window", () => {
  for (const code of [0, 5]) {
    const p = Bun.spawnSync([process.execPath, main, app], { env: { ...process.env, EXIT_CODE: String(code) }, stderr: "pipe" });
    expect(p.stderr.toString()).not.toContain("did not start");
    expect(p.exitCode).toBe(code);
  }
}, 8_000); // well under the 10 s the bootstrap used to wait
