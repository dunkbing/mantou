// More windows (dunkbing/mantou#23): each has an instance of its own in the
// core, and the same Worker drives them all, one commit per window per turn.
import { MantouCore } from "./core";
import { openCore } from "./ffi";
import type { JSX } from "./jsx-runtime";
import type { WindowOptions } from "./main";
import { activeUi, setActiveUi } from "./platform";
import { mount } from "./solid/mount";
import type { Ui } from "./ui";
import { encodeWindowConfig } from "./winconfig";

export interface OpenWindowOptions extends WindowOptions {
  title?: string;
}

/** Another window, from `openWindow`. */
export interface WindowHandle {
  /** The window's own node tree (its components use it through `useUi()`). */
  readonly ui: Ui;
  /** Its instance in the core (for tests and debugging). */
  readonly id: number;
  readonly closed: boolean;
  /** Closes it: its components are disposed and the window goes. */
  close(): void;
  /** Brings it to the front, with the keyboard. */
  focus(): void;
  setTitle(title: string): void;
  /**
   * The user asked to close it (its close button, or Cmd/Ctrl+W). It closes
   * unless a handler returns `false`. Returns a function that removes it.
   */
  onClose(handler: () => boolean | void): () => void;
}

/**
 * Opens another window and renders `app` in it. Call it once the app's window
 * is up (after `run()`, from a handler or an effect). The new window has its
 * own tree: signals shared with the first window update both.
 */
export function openWindow(app: () => JSX.Element, options: OpenWindowOptions = {}): WindowHandle {
  const { title = "Mantou", width = 480, height = 360, ...rest } = options;
  const cfg = encodeWindowConfig({ ...rest, width, height }, title);
  const handle = openCore().symbols.mt_window_open(cfg, cfg.byteLength);
  if (!handle) throw new Error("mantou: openWindow needs the app's window to be open first (call it after run())");
  const core = new MantouCore(handle);
  core.ui.title(title);
  // Platform services (dialogs, `win`) keep going to the window they went to.
  const before = activeUi();
  const dispose = mount(core.ui, app);
  setActiveUi(before);
  const closers: (() => boolean | void)[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dispose();
    core.ui.flush();
    core.detach();
    core.lib.symbols.mt_window_close(handle);
  };
  core.onEvent = (e) => {
    if (e.type !== "closeRequested") return;
    let keep = false;
    for (const f of [...closers]) keep = f() === false || keep;
    if (!keep) close();
  };
  return {
    ui: core.ui,
    id: handle,
    get closed() {
      return closed;
    },
    close,
    focus: () => !closed && core.lib.symbols.mt_window_focus(handle),
    setTitle: (t) => !closed && core.ui.title(t),
    onClose(handler) {
      closers.push(handler);
      return () => void closers.splice(closers.indexOf(handler) >>> 0, 1);
    },
  };
}
