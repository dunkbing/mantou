// A window's size, position, maximized and full screen state, kept between launches (dunkbing/mantou#67)
// in the app's config folder (`window-state.json`, one entry per window). The core checks that a saved
// position is still on a display when it opens the window, and lets the system place it otherwise.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, where } from "./paths";
import type { WindowInfo } from "./platform";
import type { Ui } from "./ui";

/** What is kept of a window: its last normal (not maximized, not full screen) box, and those two states. */
export interface SavedWindow {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

const NAME = "window-state.json";
let dirOverride: string | undefined;
/** Test hook: keep the file in `dir` instead of the app's config folder (undefined: back to it). */
export function setWindowStateDir(dir: string | undefined) {
  dirOverride = dir;
}

function readAll(): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(join(dirOverride ?? where("config"), NAME), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The saved state of window `key`, if there is a valid one. */
export function loadWindow(key: string): SavedWindow | null {
  const v = readAll()[key] as Record<string, unknown> | undefined;
  if (!v || !num(v.width) || !num(v.height) || v.width < 1 || v.height < 1) return null;
  const at = num(v.x) && num(v.y);
  return {
    ...(at ? { x: v.x as number, y: v.y as number } : {}),
    width: Math.round(v.width),
    height: Math.round(v.height),
    maximized: v.maximized === true,
    fullscreen: v.fullscreen === true,
  };
}

/** Saves window `key`'s state, keeping the other windows' (written to a temporary file, then renamed). */
export function saveWindow(key: string, s: SavedWindow) {
  const all = readAll();
  all[key] = s;
  const file = join(dirOverride ?? paths.config, NAME);
  writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** `options` with window `key`'s saved size, position and state in place of theirs. */
export function restoredOptions<T extends { width?: number; height?: number; x?: number; y?: number; maximized?: boolean; fullscreen?: boolean }>(
  key: string,
  options: T,
): { options: T & Partial<SavedWindow>; saved: SavedWindow | null } {
  const saved = loadWindow(key);
  return { options: saved ? { ...options, ...saved } : options, saved };
}

/**
 * Keeps window `key`'s state saved as it changes: a moment after it moves, resizes, or is maximized, made full
 * screen or restored, the window is asked for its state and the file is written if that changed. `save()` does it
 * now (before quitting). A minimized window keeps what was saved before.
 */
export function rememberWindow(ui: Ui, key: string, saved: SavedWindow | null, delayMs = 400) {
  let normal = saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : undefined;
  let last = saved ? JSON.stringify(saved) : "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    clearTimeout(timer);
    timer = undefined;
    const s = await ui.service<WindowInfo>({ kind: "window", op: "state" });
    if (!s || s.minimized) return;
    if (!s.maximized && !s.fullscreen) normal = { x: s.x, y: s.y, width: s.width, height: s.height };
    if (!normal) return;
    const record: SavedWindow = { ...normal, maximized: s.maximized, fullscreen: s.fullscreen };
    const json = JSON.stringify(record);
    if (json === last) return;
    last = json;
    try {
      saveWindow(key, record);
    } catch (err) {
      console.error("mantou: cannot save the window's state:", err);
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, delayMs);
  };
  const offs = [ui.onResize(later), ui.onWindowState(later)];
  return {
    save,
    stop() {
      clearTimeout(timer);
      offs.forEach((f) => f());
    },
  };
}
