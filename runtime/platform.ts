// Platform services (design §10) as async functions: file dialogs, message
// boxes, the app menu and context menus. They go through the core, which shows
// the native UI; a headless instance answers from what the test queued.
import type { Ui, WindowState } from "./ui";

let active: Ui | null = null;

/** The Ui the services talk to: the one last mounted (`mount` sets it). */
export function setActiveUi(ui: Ui | null) {
  active = ui;
}

/** The Ui the services talk to, if an app is mounted. */
export function activeUi(): Ui | null {
  return active;
}

function ui(): Ui {
  if (!active) throw new Error("mantou: no window yet: mount an app before using platform services");
  return active;
}

export interface FileFilter {
  name: string;
  /** Without the dot: ["png", "jpg"]. */
  extensions: string[];
}

export interface OpenFileOptions {
  title?: string;
  /** The folder the dialog starts in. */
  directory?: string;
  filters?: FileFilter[];
  multiple?: boolean;
  /** Choose folders instead of files. */
  pickFolders?: boolean;
}

export interface SaveFileOptions {
  title?: string;
  directory?: string;
  /** The suggested file name. */
  name?: string;
  filters?: FileFilter[];
}

export interface MessageOptions {
  title?: string;
  message: string;
  level?: "info" | "warning" | "error";
  /** Button labels, the first being the default. One to three. Default ["OK"]. */
  buttons?: string[];
}

export interface MenuItem {
  /** What `onMenu` / a context menu's answer reports. Default: the label. */
  id?: string;
  label?: string;
  /** "cmd+s", "ctrl+shift+n"… */
  accelerator?: string;
  enabled?: boolean;
  /** A check mark item, checked or not. */
  checked?: boolean;
  /** A submenu. */
  items?: MenuItem[];
  separator?: true;
  /** A standard item the OS handles: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "hide" | "hideOthers" | "showAll" | "minimize" | "closeWindow" | "zoom" | "fullscreen" | "about" | "quit". */
  role?: string;
}

/** The system clipboard's text. Images aren't supported yet. */
export const clipboard = {
  /** The text on the clipboard, or null when there is none. */
  readText: () => ui().service<string>({ kind: "clipboardRead" }),
  /** Puts text on the clipboard. */
  writeText: async (text: string): Promise<void> => void (await ui().service<boolean>({ kind: "clipboardWrite", text })),
};

/** A dialog request: rejects when the core can't show one (Linux with no portal and no zenity), so a cancel stays null. */
async function dialog<T>(request: { kind: string } & Record<string, unknown>): Promise<T | null> {
  const a = await ui().service<T | { unavailable: string }>(request);
  if (a && typeof a === "object" && !Array.isArray(a) && "unavailable" in a) throw new Error(`mantou: ${a.unavailable}`);
  return a as T | null;
}

/** Choose files (or folders); the paths, or null when cancelled. */
export async function openFile(options: OpenFileOptions = {}): Promise<string[] | null> {
  const paths = await dialog<string[]>({ kind: "openFile", ...options });
  return paths && paths.length ? paths : null; // some platforms' dialogs answer an empty list when cancelled
}

/** Choose where to save; the path, or null when cancelled. */
export function saveFile(options: SaveFileOptions = {}): Promise<string | null> {
  return dialog<string>({ kind: "saveFile", ...options });
}

/** Shows a message box; the index of the button chosen, or null when it was dismissed. */
export function message(options: MessageOptions): Promise<number | null> {
  return dialog<number>({ kind: "message", ...options });
}

/**
 * Which dialogs the system can show: always both on macOS and Windows. On Linux, file dialogs need the desktop
 * portal (with a file chooser backend) or zenity, and message boxes need zenity. When one can't be shown, its
 * function rejects instead of answering null. A headless instance answers what its test queued, else both.
 */
export async function dialogsAvailable(): Promise<{ files: boolean; messages: boolean }> {
  const a = await ui().service<{ files: boolean; messages: boolean }>({ kind: "dialogs" });
  return { files: a?.files !== false, messages: a?.messages !== false };
}

/** Shows a context menu at logical (x, y); the chosen item's id, or null when it was dismissed. */
export function showMenu(items: MenuItem[], at: { x: number; y: number }): Promise<string | null> {
  return ui().service<string>({ kind: "showMenu", items, ...at });
}

/**
 * Sets the app menu (the menu bar on macOS) to these top-level menus, each a
 * `{ label, items }`. macOS starts with the standard App, Edit and Window
 * menus. Chosen items reach `onMenu`.
 */
export async function setMenu(menus: MenuItem[]): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "setMenu", menu: menus })) === true;
}

/** Listens for items of the app menu being chosen; returns a function that stops. */
export function onMenu(handler: (id: string) => void): () => void {
  return ui().onMenu(handler);
}

/** Window-level file drops: files held over the window (kind 0), leaving it (1) or dropped (2), when no view with `onDrop`/`onDragOver` took them. */
export function onFileDrop(handler: (kind: 0 | 1 | 2, e: { x: number; y: number; files: string[] }) => void): () => void {
  return ui().onFileDrop(handler);
}

/** The window's size and state, as the core answers a window request. */
export interface WindowInfo extends WindowState {
  width: number;
  height: number;
}

const windowOp = (op: string, extra: object = {}) => ui().service<WindowInfo>({ kind: "window", op, ...extra });

/**
 * The window. Each call asks the OS, which may take a moment (full screen animates), so the answer is the
 * state right after asking; `onState` hears the change when it happens. Resolve to null when there's no window.
 */
let overlay = false;
/** Called by `run` with the window's title bar choice. */
export function setTitleBar(on: boolean) {
  overlay = on;
}

export const win = {
  /** Where the content must leave room for the system's buttons with `titleBar: "overlay"` (macOS: the traffic lights); zeros otherwise. */
  get safeArea() {
    return overlay && process.platform === "darwin" ? { top: 28, left: 72 } : { top: 0, left: 0 };
  },
  /** Asks the window to close like its button does: the app gets `closeRequested` (and quits, unless `quitOnClose: false`). */
  close: () => windowOp("close"),
  setFullscreen: (on = true) => windowOp("fullscreen", { value: on }),
  setMaximized: (on = true) => windowOp("maximize", { value: on }),
  minimize: () => windowOp("minimize", { value: true }),
  /** Brings a minimized window back and focuses it (what "Show window" from a tray icon needs). */
  restore: async () => {
    await windowOp("minimize", { value: false });
    return windowOp("focus");
  },
  setAlwaysOnTop: (on = true) => windowOp("alwaysOnTop", { value: on }),
  /** Remove (or restore) the title bar and border. */
  setFrameless: (on = true) => windowOp("frameless", { value: on }),
  /** The outer position, logical px from the screen's top left. */
  setPosition: (x: number, y: number) => windowOp("position", { x, y }),
  /** The content size, logical px. */
  setSize: (width: number, height: number) => windowOp("size", { width, height }),
  focus: () => windowOp("focus"),
  /** Asks for the window's size and state. */
  state: () => windowOp("state"),
  /** Hears focus, moves, minimize, maximize and full screen changes; returns a function that stops. */
  onState: (handler: (s: WindowState) => void) => ui().onWindowState(handler),
  /** The display the window is on, or null. */
  monitor: async (): Promise<Monitor | null> => (await monitors()).find((m) => m.current) ?? null,
};

/** A display, in logical px (the coordinates windows are placed with). */
export interface Monitor {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Device pixels per logical px. */
  scale: number;
  /** In Hz, when the system says. */
  refreshRate: number | null;
  primary: boolean;
  /** The window is on it. */
  current: boolean;
}

/** The displays. Empty with no window (a headless instance answers what its test queued). */
export async function monitors(): Promise<Monitor[]> {
  return (await ui().service<Monitor[]>({ kind: "monitors" })) ?? [];
}

/** Opens a URL (or a file) in the default app. Resolves whether it could be started. */
export async function openExternal(url: string): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "openExternal", url })) === true;
}

/** Shows a file in Finder, Explorer or the file manager. */
export async function reveal(path: string): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "reveal", path })) === true;
}

export interface NotifyOptions {
  title: string;
  body?: string;
}

/** Shows a desktop notification. Resolves whether it was shown (not whether it was clicked). */
export async function notify(options: NotifyOptions): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "notify", ...options })) === true;
}

/** The count (or text) on the dock icon; 0, "" or null clears it. macOS only: resolves false elsewhere. */
export async function setBadge(badge: number | string | null): Promise<boolean> {
  const text = badge === null || badge === 0 ? "" : String(badge);
  return (await ui().service<boolean>({ kind: "setBadge", text })) === true;
}

export interface TrayOptions {
  /** A PNG, JPEG, WebP or SVG file. */
  icon: string;
  tooltip?: string;
  /** Items as for `setMenu`; chosen ones reach `onMenu`. */
  menu?: MenuItem[];
}

/** Adds an icon to the menu bar (macOS; false elsewhere for now). */
export async function createTray(options: TrayOptions): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "createTray", ...options })) === true;
}

/** Removes the tray icon. */
export async function removeTray(): Promise<boolean> {
  return (await ui().service<boolean>({ kind: "removeTray" })) === true;
}
