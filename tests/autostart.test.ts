// Launch at login: the entry the OS reads is written, found and removed again (macOS and Linux; Windows uses `reg`).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform === "win32")("set(true) writes the entry, get() sees it, set(false) removes it", async () => {
  const home = mkdtempSync(join(tmpdir(), "mantou-autostart-"));
  // The other tests in this process read these: put them back afterwards.
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, MANTOU_APP: process.env.MANTOU_APP };
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  process.env.MANTOU_APP = "autostart-test";
  try {
    const { launchAtLogin } = await import("../runtime/autostart");
    expect(await launchAtLogin.get()).toBe(false);
    expect(await launchAtLogin.set(true)).toBe(true);
    expect(await launchAtLogin.get()).toBe(true);
    const file = process.platform === "darwin" ? join(home, "Library/LaunchAgents/mantou.autostart-test.plist") : join(home, ".config/autostart/autostart-test.desktop");
    expect(readFileSync(file, "utf8")).toContain(process.execPath);
    await launchAtLogin.set(false);
    expect(await launchAtLogin.get()).toBe(false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
