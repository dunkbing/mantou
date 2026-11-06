// Embedded files (#86): the path check, and a compiled executable that reads its own embedded icon.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embeddedBytes, isEmbedded, realPath } from "../runtime/embedded";
import { makeIcns } from "../runtime/icns";

test("which paths are embedded", () => {
  expect(isEmbedded("/$bunfs/root/tray.svg")).toBe(true);
  expect(isEmbedded("B:/~BUN/root/tray.svg")).toBe(true);
  expect(isEmbedded("B:\\~BUN\\root\\tray.svg")).toBe(true);
  expect(isEmbedded("file:///$bunfs/root/tray.svg")).toBe(true);
  expect(isEmbedded("/tmp/tray.svg")).toBe(false);
  expect(isEmbedded("assets/tray.svg")).toBe(false);
  expect(embeddedBytes("assets/tray.svg")).toBeNull();
  expect(realPath("assets/tray.svg")).toBe("assets/tray.svg");
});

test("an executable gets a real file for its embedded icon", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-embedded-"));
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>`;
    writeFileSync(join(dir, "tray.svg"), svg);
    const runtime = join(import.meta.dir, "..", "runtime", "embedded.ts");
    writeFileSync(
      join(dir, "app.ts"),
      `import icon from "./tray.svg" with { type: "file" };
import { readFileSync } from "node:fs";
import { isEmbedded, realPath } from ${JSON.stringify(runtime)};
const real = realPath(icon);
console.log(JSON.stringify({ embedded: isEmbedded(icon), real, same: readFileSync(real, "utf8") }));\n`,
    );
    const exe = join(dir, process.platform === "win32" ? "app.exe" : "app");
    const b = Bun.spawnSync(["bun", "build", "--compile", join(dir, "app.ts"), "--outfile", exe], { cwd: dir });
    expect(b.exitCode).toBe(0);
    const r = Bun.spawnSync([exe]);
    const out = JSON.parse(r.stdout.toString());
    expect(out.embedded).toBe(true);
    expect(isEmbedded(out.real)).toBe(false);
    expect(existsSync(out.real)).toBe(true);
    expect(out.same).toBe(svg);
    rmSync(out.real, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("an .icns holds the icon at 16 to 1024 px", () => {
  const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>`);
  const icns = makeIcns(svg);
  const v = new DataView(icns.buffer);
  expect(new TextDecoder().decode(icns.subarray(0, 4))).toBe("icns");
  expect(v.getUint32(4)).toBe(icns.length);
  const types: string[] = [];
  for (let at = 8; at < icns.length; at += v.getUint32(at + 4)) types.push(new TextDecoder().decode(icns.subarray(at, at + 4)));
  expect(types).toEqual(["icp4", "icp5", "ic11", "ic12", "ic07", "ic13", "ic08", "ic14", "ic09", "ic10"]);
});
