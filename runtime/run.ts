// The app's entry point in the Worker: opens the window's instance and renders.
import { followSystemMotion } from "./motion";
import { readFileSync } from "node:fs";
import { MantouCore } from "./core";
import type { WindowOptions } from "./main";
import type { JSX } from "./jsx-runtime";
import { mount } from "./solid/mount";
import { setTitleBar } from "./platform";
import { rememberWindow, restoredOptions } from "./winstate";

export interface RunOptions extends WindowOptions {
  /** The window's title until the app sets one. */
  title?: string;
  /** Quit when the user closes the window (default true). */
  quitOnClose?: boolean;
  /** Font files to register before the app renders: paths, or the files' bytes. */
  fonts?: (string | Uint8Array)[];
  /**
   * Open where, how big and how (maximized, full screen) the window was when the app last closed, and keep
   * that saved as it changes (in `paths.config`'s `window-state.json`). A string names the entry (default "main").
   */
  restoreState?: boolean | string;
}

/** Renders `app` in the window and starts the native event loop. */
/** @internal Set by `mantou snap`: `run()` mounts the app into it (a headless instance) instead of opening a window. */
export const SNAP = Symbol.for("mantou.snap");

export function run(app: () => JSX.Element, options: RunOptions = {}): MantouCore {
  const snap = (globalThis as Record<symbol, unknown>)[SNAP] as ((app: () => JSX.Element, options: RunOptions) => unknown) | undefined;
  if (snap) return snap(app, options) as MantouCore;
  const key = options.restoreState === true ? "main" : options.restoreState || null;
  const restored = key ? restoredOptions(key, options) : null;
  if (restored) options = restored.options;
  const core = new MantouCore();
  followSystemMotion();
  const remember = key ? rememberWindow(core.ui, key, restored!.saved) : null;
  setTitleBar(options.titleBar === "overlay" && !options.frameless);
  if (options.title) core.ui.title(options.title);
  for (const f of options.fonts ?? []) core.ui.registerFont(typeof f === "string" ? new Uint8Array(readFileSync(f)) : f);
  mount(core.ui, app);
  if (options.quitOnClose !== false) {
    core.onEvent = (e) => {
      if (e.type === "closeRequested") {
        if (remember) void remember.save().finally(() => core.quit(0));
        else core.quit(0);
      }
    };
  }
  const { width, height, minWidth, minHeight, maxWidth, maxHeight, resizable, frameless, titleBar, alwaysOnTop, fullscreen, maximized, x, y } = options;
  core.ready({ width, height, minWidth, minHeight, maxWidth, maxHeight, resizable, frameless, titleBar, alwaysOnTop, fullscreen, maximized, x, y });
  return core;
}
