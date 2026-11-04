// Platform services (design §10) as async functions: file dialogs, message
// boxes, the app menu and context menus. They go through the core, which shows
// the native UI; a headless instance answers from what the test queued.
import type { Ui, WindowState } from "./ui";

let active: Ui | null = null;

/** The Ui the services talk to: the one last mounted (`mount` sets it). */
export function setActiveUi(ui: Ui | null) {
  active = ui;
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

/** Choose files (or folders); the paths, or null when cancelled. */
export function openFile(options: OpenFileOptions = {}): Promise<string[] | null> {
  return ui().service<string[]>({ kind: "openFile", ...options });
}

/** Choose where to save; the path, or null when cancelled. */
export function saveFile(options: SaveFileOptions = {}): Promise<string | null> {
  return ui().service<string>({ kind: "saveFile", ...options });
}

/** Shows a message box; the index of the button chosen, or null when it was dismissed. */
export function message(options: MessageOptions): Promise<number | null> {
  return ui().service<number>({ kind: "message", ...options });
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
export const win = {
  setFullscreen: (on = true) => windowOp("fullscreen", { value: on }),
  setMaximized: (on = true) => windowOp("maximize", { value: on }),
  minimize: () => windowOp("minimize", { value: true }),
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
};
