// Worker-side client of the native core: encodes ops, flushes them once per JS
// turn, and drains events when the core wakes the Worker (DESIGN.md §8).
import { JSCallback } from "bun:ffi";
import { openCore, type CoreLib } from "./ffi";

export type CoreEvent =
  | { type: "windowReady"; width: number; height: number; scale: number }
  | { type: "resized"; width: number; height: number }
  | { type: "pointerMove"; x: number; y: number }
  | { type: "pointerDown" | "pointerUp"; button: number; x: number; y: number }
  | { type: "keyDown"; key: string; repeat: boolean }
  | { type: "keyUp"; key: string }
  | { type: "closeRequested" }
  | { type: "scaleChanged"; scale: number };

export interface Stats {
  frames: number;
  commits: number;
  wakes: number;
  events: number;
  resizes: number;
  redrawRequests: number;
}

const OP_CLEAR_COLOR = 1;
const OP_TITLE = 2;

function keyName(code: number): string {
  if (code === 0x110000) return "Escape";
  if (code === 0x110001) return "Enter";
  if (code >= 0x110000) return "Unidentified";
  return String.fromCodePoint(code);
}

class OpEncoder {
  private buf = new ArrayBuffer(4096);
  private u32 = new Uint32Array(this.buf);
  private f32 = new Float32Array(this.buf);
  private len = 0; // in words

  private reserve(words: number) {
    if (this.len + words <= this.u32.length) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, (this.len + words) * 4));
    new Uint32Array(next).set(this.u32.subarray(0, this.len));
    this.buf = next;
    this.u32 = new Uint32Array(next);
    this.f32 = new Float32Array(next);
  }

  clearColor(r: number, g: number, b: number, a: number) {
    this.reserve(5);
    this.u32[this.len] = OP_CLEAR_COLOR;
    this.f32.set([r, g, b, a], this.len + 1);
    this.len += 5;
  }

  title(s: string) {
    const bytes = new TextEncoder().encode(s);
    const words = Math.ceil(bytes.length / 4);
    this.reserve(2 + words);
    this.u32[this.len] = OP_TITLE;
    this.u32[this.len + 1] = bytes.length;
    new Uint8Array(this.buf, (this.len + 2) * 4, words * 4).fill(0).set(bytes);
    this.len += 2 + words;
  }

  get empty() {
    return this.len === 0;
  }

  take(): Uint8Array {
    const out = new Uint8Array(this.buf, 0, this.len * 4);
    this.len = 0;
    return out;
  }
}

export class MantouCore {
  readonly lib: CoreLib = openCore();
  /** Events delivered to JS so far, by type. */
  readonly received: Record<string, number> = {};
  onEvent: (e: CoreEvent) => void = () => {};

  private ops = new OpEncoder();
  private scheduled = false;
  private evbuf = new Uint8Array(64 * 1024);
  private ev32 = new Uint32Array(this.evbuf.buffer);
  private evf32 = new Float32Array(this.evbuf.buffer);
  private wake: JSCallback;
  // Keeps the Worker's event loop alive while it waits for wake-ups; a timer
  // this far away costs nothing.
  private keepAlive = setInterval(() => {}, 1e9);

  constructor() {
    this.wake = new JSCallback(() => this.drain(), { args: [], returns: "void", threadsafe: true });
    this.lib.symbols.mt_set_wake(this.wake.ptr);
    // The main thread runs no JS, so nothing there would notice a crash here.
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
    this.ops.clearColor(r, g, b, a);
    this.schedule();
  }

  title(s: string) {
    this.ops.title(s);
    this.schedule();
  }

  /** One commit per JS turn (DESIGN.md §5.2 invariant 3). */
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush() {
    this.scheduled = false;
    if (this.ops.empty) return;
    const bytes = this.ops.take();
    const r = this.lib.symbols.mt_commit(bytes, bytes.byteLength);
    if (r !== 0) throw new Error(`mantou: the core refused a commit (${r})`);
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
      case 1: e = { type: "windowReady", width: w[i + 1], height: w[i + 2], scale: f[i + 3] }; break;
      case 2: e = { type: "resized", width: w[i + 1], height: w[i + 2] }; break;
      case 3: e = { type: "pointerMove", x: f[i + 2], y: f[i + 3] }; break;
      case 4: e = { type: "pointerDown", button: w[i + 1], x: f[i + 2], y: f[i + 3] }; break;
      case 5: e = { type: "pointerUp", button: w[i + 1], x: f[i + 2], y: f[i + 3] }; break;
      case 6: e = { type: "keyDown", key: keyName(w[i + 1]), repeat: w[i + 2] !== 0 }; break;
      case 7: e = { type: "keyUp", key: keyName(w[i + 1]) }; break;
      case 8: e = { type: "closeRequested" }; break;
      case 9: e = { type: "scaleChanged", scale: f[i + 3] }; break;
      default: return;
    }
    this.received[e.type] = (this.received[e.type] ?? 0) + 1;
    this.onEvent(e);
  }

  stats(): Stats {
    const a = new BigUint64Array(6);
    this.lib.symbols.mt_stats(a, a.length);
    const [frames, commits, wakes, events, resizes, redrawRequests] = Array.from(a, Number);
    return { frames, commits, wakes, events, resizes, redrawRequests };
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

  quit(code = 0) {
    this.flush();
    clearInterval(this.keepAlive);
    this.lib.symbols.mt_quit(code);
  }
}
