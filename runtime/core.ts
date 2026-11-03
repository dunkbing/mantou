// Worker-side client of the native core: commits the Ui's op batches through
// FFI (one per JS turn) and drains events when the core wakes the Worker
// (design §8).
import { JSCallback } from "bun:ffi";
import { openCore, type CoreLib } from "./ffi";
import { EventReader, statsFrom, STAT_NAMES, type CoreEvent, type Stats } from "./events";
import { Ui } from "./ui";

export type { CoreEvent, Stats } from "./events";

export class MantouCore {
  readonly lib: CoreLib = openCore();
  /** The window's instance handle. */
  readonly handle = this.lib.symbols.mt_app();
  readonly ui: Ui;
  /** Events delivered to JS so far, by type. */
  readonly received: Record<string, number> = {};
  /** Called for every event, after presses reach their handlers. */
  onEvent: (e: CoreEvent) => void = () => {};

  private events = new EventReader();
  private wake: JSCallback;
  // Keeps the Worker's event loop alive while it waits for wake-ups; a timer
  // this far away costs nothing.
  private keepAlive = setInterval(() => {}, 1e9);

  constructor() {
    this.ui = new Ui({
      commit: (bytes) => {
        const r = this.lib.symbols.mt_commit(this.handle, bytes, bytes.byteLength);
        if (r !== 0) throw new Error(`mantou: the core rejected a batch (${r})`);
      },
    });
    this.wake = new JSCallback(() => this.drain(), { args: [], returns: "void", threadsafe: true });
    this.lib.symbols.mt_set_wake(this.handle, this.wake.ptr);
    // The main thread runs no JS, so nothing there would notice a crash here
    // (design §5.2 invariant 6).
    const fatal = (what: string, err: unknown) => {
      console.error(`mantou: ${what} in the app Worker:`, err);
      this.quit(70);
    };
    globalThis.addEventListener("error", (e) => fatal("uncaught error", (e as ErrorEvent).error ?? e));
    globalThis.addEventListener("unhandledrejection", (e) => fatal("unhandled rejection", (e as Event & { reason?: unknown }).reason));
  }

  /** Tells the bootstrap the Worker is ready; it then starts the native loop. */
  ready() {
    postMessage("mantou:ready");
  }

  clearColor(r: number, g: number, b: number, a = 1) {
    this.ui.clearColor(r, g, b, a);
  }

  title(s: string) {
    this.ui.title(s);
  }

  private drain() {
    this.events.drain(
      (buf) => this.lib.symbols.mt_take_events(this.handle, buf, buf.byteLength),
      (e) => {
        this.received[e.type] = (this.received[e.type] ?? 0) + 1;
        if (e.type === "press") this.ui.dispatchPress(e.target, e.x, e.y);
        this.onEvent(e);
      },
    );
  }

  stats(): Stats {
    const a = new BigUint64Array(STAT_NAMES.length);
    this.lib.symbols.mt_stats(this.handle, a, a.length);
    return statsFrom(a);
  }

  info(): string {
    const b = new Uint8Array(512);
    const n = this.lib.symbols.mt_info(b, b.length);
    return new TextDecoder().decode(b.subarray(0, n));
  }

  /** Test hook: resizes the window from a native thread (see mt_test_resize). */
  testResize(count: number, intervalMs: number, a: [number, number], b: [number, number]) {
    this.lib.symbols.mt_test_resize(count, intervalMs, a[0], a[1], b[0], b[1]);
  }

  /** Test hook: pointer input in logical px, handled like the window's own. */
  testPointer(kind: "down" | "up" | "move", x: number, y: number) {
    this.lib.symbols.mt_test_input(this.handle, kind === "down" ? 0 : kind === "up" ? 1 : 2, x, y);
  }

  /** Test hook: the id of the topmost node at logical (x, y), or 0. */
  hit(x: number, y: number): number {
    return this.lib.symbols.mt_test_hit(this.handle, x, y);
  }

  /** Test hook: a node's laid-out box [x0, y0, x1, y1] in logical px, or null. */
  nodeRect(id: number): [number, number, number, number] | null {
    const r = new Float32Array(4);
    return this.lib.symbols.mt_test_node_rect(this.handle, id, r) === 0 ? [r[0], r[1], r[2], r[3]] : null;
  }

  quit(code = 0) {
    this.ui.flush();
    clearInterval(this.keepAlive);
    this.lib.symbols.mt_quit(code);
  }
}
