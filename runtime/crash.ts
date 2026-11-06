// A startup failure (the core won't load, the app throws while loading) must not vanish: a double-clicked Windows app has no
// console, so the message goes to a log file and into a message box that names it.
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Where the crash log goes: `%LOCALAPPDATA%\<app>\crash.log` on Windows, `<state dir>/<app>/crash.log` elsewhere. */
export function crashLogPath(app = basename(process.execPath).replace(/\.exe$/i, "")): string {
  const home = process.env.HOME ?? ".";
  const base =
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? home, "AppData", "Local"))
      : process.platform === "darwin"
        ? join(home, "Library", "Logs")
        : (process.env.XDG_STATE_HOME ?? join(home, ".local", "state"));
  return join(base, app, "crash.log");
}

const text = (err: unknown) => (err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err));

/** A compiled app (no console of its own on Windows); `mantou run` and tests print to the terminal instead. */
const compiled = () => !/^bun(-debug)?(\.exe)?$/i.test(basename(process.execPath));

/** Windows: a native message box (blocks until closed). */
function messageBox(title: string, body: string) {
  const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const wide = (s: string) => ptr(new Uint8Array(Buffer.from(s + "\0", "utf16le")));
  const user32 = dlopen("user32.dll", { MessageBoxW: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" } });
  user32.symbols.MessageBoxW(null, wide(body), wide(title), 0x10 | 0x10000); // MB_OK | MB_ICONERROR | MB_SETFOREGROUND
}

/**
 * Records a fatal startup error: to stderr, to the crash log, and (a compiled Windows app, unless MANTOU_NO_DIALOG is set)
 * in a message box. Returns the log path, or null if it couldn't be written. Never throws.
 */
export function reportFatal(err: unknown, app?: string): string | null {
  const body = text(err);
  console.error(body);
  let log: string | null = crashLogPath(app);
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `[${new Date().toISOString()}] ${process.platform}-${process.arch} ${process.execPath}\n${body}\n\n`);
  } catch {
    log = null;
  }
  if (process.platform === "win32" && compiled() && !process.env.MANTOU_NO_DIALOG) {
    try {
      const name = app ?? basename(process.execPath).replace(/\.exe$/i, "");
      const first = body.split("\n")[0].slice(0, 300);
      messageBox(`${name} could not start`, `${first}\n\n${log ? `Details: ${log}` : "(the details could not be saved)"}`);
    } catch {} // no dialog is better than a second failure
  }
  return log;
}
