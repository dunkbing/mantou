// Start the app when the user logs in: a LaunchAgent (macOS), the Run key (Windows) or an autostart entry (Linux).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { where } from "./paths";

const name = () => basename(where("config"));
const command = () => [process.execPath, ...process.argv.slice(1)];
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function path(): string {
  const home = process.env.HOME || homedir();
  return process.platform === "darwin"
    ? join(home, "Library", "LaunchAgents", `mantou.${name()}.plist`)
    : join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "autostart", `${name()}.desktop`);
}

function entry(): string {
  const args = command();
  if (process.platform === "darwin") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>mantou.${xml(name())}</string>
<key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
  }
  return `[Desktop Entry]\nType=Application\nName=${name()}\nExec=${args.map(quote).join(" ")}\n`;
}

async function reg(...a: string[]): Promise<boolean> {
  return (await Bun.spawn(["reg", ...a], { stdout: "ignore", stderr: "ignore" }).exited) === 0;
}

/** Whether the app starts at login, and turning that on or off. The command is the one running now. */
export const launchAtLogin = {
  async get(): Promise<boolean> {
    return process.platform === "win32" ? reg("query", RUN, "/v", name()) : existsSync(path());
  },
  async set(on: boolean): Promise<boolean> {
    if (process.platform === "win32") {
      return on ? reg("add", RUN, "/v", name(), "/t", "REG_SZ", "/d", command().map(quote).join(" "), "/f") : (await reg("delete", RUN, "/v", name(), "/f"), true);
    }
    const p = path();
    if (!on) return rmSync(p, { force: true }), true;
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, entry());
    return true;
  },
};
