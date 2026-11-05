// Per-user directories for the app: settings, data, caches. The app's name comes from `setApp`,
// `MANTOU_APP`, or the package.json in the working directory.
import { mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

let name: string | undefined;

function appName(): string {
  if (name) return name;
  try {
    const n = JSON.parse(readFileSync("package.json", "utf8")).name;
    if (typeof n === "string" && n) return n.replace(/^@[^/]+\//, "");
  } catch {}
  return "mantou-app";
}

function base(kind: "data" | "config" | "cache"): string {
  const home = homedir(), env = process.env;
  if (process.platform === "darwin") return join(home, "Library", kind === "cache" ? "Caches" : "Application Support");
  if (process.platform === "win32") {
    const roaming = env.APPDATA ?? join(home, "AppData", "Roaming"), local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return kind === "cache" ? local : kind === "data" ? local : roaming;
  }
  const xdg = { data: env.XDG_DATA_HOME ?? join(home, ".local", "share"), config: env.XDG_CONFIG_HOME ?? join(home, ".config"), cache: env.XDG_CACHE_HOME ?? join(home, ".cache") };
  return xdg[kind];
}

/** The app's folder of that kind, without creating it. */
export function where(kind: "data" | "config" | "cache" | "temp"): string {
  const app = process.env.MANTOU_APP || appName();
  return kind === "temp" ? join(tmpdir(), app) : join(base(kind), app);
}

// The folder is created on first read (`mkdir -p`), so `${paths.config}/settings.json` can be written at once.
function dir(kind: "data" | "config" | "cache" | "temp"): string {
  const p = where(kind);
  mkdirSync(p, { recursive: true });
  return p;
}

export const paths = {
  /** Sets the app's name (folder name) instead of the package.json's. */
  setApp(n: string) { name = n; },
  get data() { return dir("data"); },
  get config() { return dir("config"); },
  get cache() { return dir("cache"); },
  get temp() { return dir("temp"); },
};
