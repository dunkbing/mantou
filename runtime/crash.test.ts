import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { reportFatal } from "./crash";

test("a fatal startup error is written to the app's crash log", () => {
  const dir = mkdtempSync(`${tmpdir()}/mantou-crash-`);
  const saved = { HOME: process.env.HOME, LOCALAPPDATA: process.env.LOCALAPPDATA, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  Object.assign(process.env, { HOME: dir, LOCALAPPDATA: dir, XDG_STATE_HOME: dir });
  const err = console.error;
  console.error = () => {};
  try {
    const log = reportFatal(new Error("the core won't load"), "Demo");
    expect(log).not.toBeNull();
    expect(log).toContain("Demo");
    expect(readFileSync(log!, "utf8")).toContain("the core won't load");
  } finally {
    console.error = err;
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(dir, { recursive: true, force: true });
  }
});
