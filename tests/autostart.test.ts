// Launch at login: the entry the OS reads is written, found and removed again (macOS and Linux; Windows uses `reg`).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform === "win32")("set(true) writes the entry, get() sees it, set(false) removes it", async () => {
  const home = mkdtempSync(join(tmpdir(), "mantou-autostart-"));
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  process.env.MANTOU_APP = "autostart-test";
  const { launchAtLogin } = await import("../runtime/autostart");
  expect(await launchAtLogin.get()).toBe(false);
  expect(await launchAtLogin.set(true)).toBe(true);
  expect(await launchAtLogin.get()).toBe(true);
  const file = process.platform === "darwin" ? join(home, "Library/LaunchAgents/mantou.autostart-test.plist") : join(home, ".config/autostart/autostart-test.desktop");
  expect(readFileSync(file, "utf8")).toContain(process.execPath);
  await launchAtLogin.set(false);
  expect(await launchAtLogin.get()).toBe(false);
  rmSync(home, { recursive: true, force: true });
});
