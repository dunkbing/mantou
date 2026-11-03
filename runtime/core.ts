// Worker-side client of the native core: commits the Ui's op batches through
// FFI (one per JS turn) and drains events when the core wakes the Worker
// (DESIGN.md §8).
import { JSCallback } from "bun:ffi";
import { openCore, type CoreLib } from "./ffi";
import { Event } from "./gen/protocol";
import { Ui } from "./ui";

export type CoreEvent =
  | { type: "windowReady"; width: number; height: number; scale: number }
  | { type: "resized"; width: number; height: number }
  | { type: "pointerMove"; x: number; y: number }
  | { type: "pointerDown" | "pointerUp"; button: number; x: number; y: number }
  | { type: "keyDown"; key: string; repeat: boolean }
  | { type: "keyUp"; key: string }
  | { type: "closeRequested" }
  | { type: "scaleChanged"; scale: number }
  | { type: "press"; target: number; x: number; y: number };

export interface Stats {
  frames: number;
  commits: number;
  wakes: number;
  events: number;
  resizes: number;
  redrawRequests: number;
  layouts: number;
  ops: number;
  opErrors: number;
  quads: number;
  nodes: number;
  presses: number;
}
const STAT_NAMES: (keyof Stats)[] = ["frames", "commits", "wakes", "events", "resizes", "redrawRequests", "layouts", "ops", "opErrors", "quads", "nodes", "presses"];

function keyName(code: number): string {
  if (code === 0x110000) return "Escape";
  if (code === 0x110001) return "Enter";
  if (code >= 0x110000) return "Unidentified";
  return String.fromCodePoint(code);
}

export class MantouCore {
  readonly lib: CoreLib = openCore();
  readonly ui: Ui;
  /** Events delivered to JS so far, by type. */
  readonly received: Record<string, number> = {};
  /** Called for every event, after presses reach their handlers. */
  onEvent: (e: CoreEvent) => void = () => {};

  private evbuf = new Uint8Array(64 * 1024);
  private ev32 = new Uint32Array(this.evbuf.buffer);
  private evf32 = new Float32Array(this.evbuf.buffer);
  private wake: JSCallback;
  // Keeps the Worker's event loop alive while it waits for wake-ups; a timer
  // this far away costs nothing.
  private keepAlive = setInterval(() => {}, 1e9);

  constructor() {
    this.ui = new Ui({
      commit: (bytes) => {
        const r = this.lib.symbols.mt_commit(bytes, bytes.byteLength);
        if (r !== 0) throw new Error(`mantou: the core rejected a batch (${r})`);
      },
    });
    this.wake = new JSCallback(() => this.drain(), { args: [], returns: "void", threadsafe: true });
    this.lib.symbols.mt_set_wake(this.wake.ptr);
    // The main thread runs no JS, so nothing there would notice a crash here
    // (DESIGN.md §5.2 invariant 6).
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
    for (;;) {
      const n = this.lib.symbols.mt_take_events(this.evbuf, this.evbuf.byteLength);
      for (let i = 0; i < n / 4; i += 4) this.dispatch(i);
      if (n < this.evbuf.byteLength) break;
    }
  }

  private dispatch(i: number) {
    const w = this.ev32, f = this.evf32;
    let e: CoreEvent;
    switch (w[i]) {
      case Event.WINDOW_READY: e = { type: "windowReady", width: w[i + 1], height: w[i + 2], scale: f[i + 3] }; break;
      case Event.RESIZED: e = { type: "resized", width: w[i + 1], height: w[i + 2] }; break;
      case Event.POINTER_MOVE: e = { type: "pointerMove", x: f[i + 2], y: f[i + 3] }; break;
      case Event.POINTER_DOWN: e = { type: "pointerDown", button: w[i + 1], x: f[i + 2], y: f[i + 3] }; break;
      case Event.POINTER_UP: e = { type: "pointerUp", button: w[i + 1], x: f[i + 2], y: f[i + 3] }; break;
      case Event.KEY_DOWN: e = { type: "keyDown", key: keyName(w[i + 1]), repeat: w[i + 2] !== 0 }; break;
      case Event.KEY_UP: e = { type: "keyUp", key: keyName(w[i + 1]) }; break;
      case Event.CLOSE_REQUESTED: e = { type: "closeRequested" }; break;
      case Event.SCALE_CHANGED: e = { type: "scaleChanged", scale: f[i + 3] }; break;
      case Event.PRESS: e = { type: "press", target: w[i + 1], x: f[i + 2], y: f[i + 3] }; break;
      default: return;
    }
    this.received[e.type] = (this.received[e.type] ?? 0) + 1;
    if (e.type === "press") this.ui.dispatchPress(e.target, e.x, e.y);
    this.onEvent(e);
  }

  stats(): Stats {
    const a = new BigUint64Array(STAT_NAMES.length);
    this.lib.symbols.mt_stats(a, a.length);
    return Object.fromEntries(STAT_NAMES.map((k, i) => [k, Number(a[i])])) as unknown as Stats;
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
    this.lib.symbols.mt_test_pointer(kind === "down" ? 0 : kind === "up" ? 1 : 2, x, y);
  }

  /** Test hook: a node's laid-out box [x0, y0, x1, y1] in logical px, or null. */
  nodeRect(id: number): [number, number, number, number] | null {
    const r = new Float32Array(4);
    return this.lib.symbols.mt_test_node_rect(id, r) === 0 ? [r[0], r[1], r[2], r[3]] : null;
  }

  quit(code = 0) {
    this.ui.flush();
    clearInterval(this.keepAlive);
    this.lib.symbols.mt_quit(code);
  }
}
