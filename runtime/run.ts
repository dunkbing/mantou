// The app's entry point in the Worker: opens the window's instance and renders.
import { MantouCore } from "./core";
import type { JSX } from "./jsx-runtime";
import { mount } from "./solid/mount";

export interface RunOptions {
  /** The window's title until the app sets one. */
  title?: string;
  /** Quit when the user closes the window (default true). */
  quitOnClose?: boolean;
}

/** Renders `app` in the window and starts the native event loop. */
export function run(app: () => JSX.Element, options: RunOptions = {}): MantouCore {
  const core = new MantouCore();
  if (options.title) core.ui.title(options.title);
  mount(core.ui, app);
  if (options.quitOnClose !== false) {
    core.onEvent = (e) => {
      if (e.type === "closeRequested") core.quit(0);
    };
  }
  core.ready();
  return core;
}
