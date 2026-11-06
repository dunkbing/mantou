// The JSX plugin's cache: a compiled file is kept, used again without loading Babel, and compiled again when it changes.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const preload = join(import.meta.dir, "preload.ts");

// Runs a process that imports `entry` with the plugin, the cache in `cache`; its stdout.
function run(entry: string, cache: string): string {
  const r = Bun.spawnSync([process.execPath, "--preload", preload, entry], { env: { ...process.env, MANTOU_JSX_CACHE: cache }, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}

test("compiled JSX is cached, and compiled again when its source changes", () => {
  // Inside the repo, so the compiled code's `mantou-ui/solid` is this package.
  const parent = join(import.meta.dir, "..", "..", "node_modules", ".cache");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "mantou-jsx-"));
  try {
    const cache = join(dir, "cache");
    const app = join(dir, "App.tsx");
    const entry = join(dir, "main.ts");
    writeFileSync(entry, `import { label } from "./App";\nconst babel = Object.keys(require.cache).some((k) => k.includes("@babel"));\nconsole.log(label(), babel);\n`);
    writeFileSync(app, `export const make = () => <view />;\nexport const label = () => "one";\n`);
    expect(run(entry, cache)).toBe("one true"); // compiled: Babel loaded
    expect(readdirSync(cache)).toHaveLength(1);
    expect(run(entry, cache)).toBe("one false"); // from the cache: no Babel
    writeFileSync(app, `export const make = () => <view />;\nexport const label = () => "two";\n`);
    expect(run(entry, cache)).toBe("two true");
    expect(readdirSync(cache)).toHaveLength(1); // the file's entry was replaced
    expect(run(entry, "0")).toBe("two true"); // no cache
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
