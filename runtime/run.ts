// The app's entry point in the Worker: opens the window's instance and renders.
import { readFileSync } from "node:fs";
import { MantouCore } from "./core";
import type { WindowOptions } from "./main";
import type { JSX } from "./jsx-runtime";
import { mount } from "./solid/mount";
import { setTitleBar } from "./platform";

export interface RunOptions extends WindowOptions {
  /** The window's title until the app sets one. */
  title?: string;
  /** Quit when the user closes the window (default true). */
  quitOnClose?: boolean;
  /** Font files to register before the app renders: paths, or the files' bytes. */
  fonts?: (string | Uint8Array)[];
}

/** Renders `app` in the window and starts the native event loop. */
export function run(app: () => JSX.Element, options: RunOptions = {}): MantouCore {
  const core = new MantouCore();
  setTitleBar(options.titleBar === "overlay" && !options.frameless);
  if (options.title) core.ui.title(options.title);
  for (const f of options.fonts ?? []) core.ui.registerFont(typeof f === "string" ? new Uint8Array(readFileSync(f)) : f);
  mount(core.ui, app);
  if (options.quitOnClose !== false) {
    core.onEvent = (e) => {
      if (e.type === "closeRequested") core.quit(0);
    };
  }
  const { width, height, minWidth, minHeight, maxWidth, maxHeight, resizable, frameless, titleBar, alwaysOnTop, fullscreen, maximized, x, y } = options;
  core.ready({ width, height, minWidth, minHeight, maxWidth, maxHeight, resizable, frameless, titleBar, alwaysOnTop, fullscreen, maximized, x, y });
  return core;
}
