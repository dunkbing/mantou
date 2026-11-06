// `mantou package` on macOS (#85): the .app has an .icns, named in Info.plist.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageMac } from "../runtime/build";

test.skipIf(process.platform !== "darwin")("the counter as a .app with an icon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mac-"));
  try {
    const icon = join(dir, "icon.svg");
    writeFileSync(icon, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#16a34a"/></svg>`);
    const app = await packageMac("examples/counter/main.tsx", join(dir, "dist"), { name: "Counter", id: "com.example.counter", version: "1.0.0", identity: "-", dmg: false, icon });
    expect(readFileSync(join(app, "Contents", "Info.plist"), "utf8")).toContain("<key>CFBundleIconFile</key><string>AppIcon</string>");
    const icns = join(app, "Contents", "Resources", "AppIcon.icns");
    expect(existsSync(icns)).toBe(true);
    // iconutil reads it back into an iconset
    const out = join(dir, "x.iconset");
    expect(Bun.spawnSync(["iconutil", "-c", "iconset", icns, "-o", out]).exitCode).toBe(0);
    expect(existsSync(join(out, "icon_512x512@2x.png"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
