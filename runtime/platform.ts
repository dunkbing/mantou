// Platform services (design §10) as async functions: file dialogs, message
// boxes, the app menu and context menus. They go through the core, which shows
// the native UI; a headless instance answers from what the test queued.
import type { Ui } from "./ui";

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
  /** A standard item the OS handles: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "hide" | "hideOthers" | "showAll" | "minimize" | "zoom" | "fullscreen" | "about" | "quit". */
  role?: string;
}

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
