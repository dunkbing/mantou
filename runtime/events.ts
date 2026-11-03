// Decodes the core's event records and counters, shared by the window client
// (core.ts) and headless instances (headless.ts).
import { Event } from "./gen/protocol";

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
export const STAT_NAMES: (keyof Stats)[] = ["frames", "commits", "wakes", "events", "resizes", "redrawRequests", "layouts", "ops", "opErrors", "quads", "nodes", "presses"];

export function statsFrom(a: BigUint64Array): Stats {
  return Object.fromEntries(STAT_NAMES.map((k, i) => [k, Number(a[i])])) as unknown as Stats;
}

function keyName(code: number): string {
  if (code === 0x110000) return "Escape";
  if (code === 0x110001) return "Enter";
  if (code >= 0x110000) return "Unidentified";
  return String.fromCodePoint(code);
}

/** Decodes the 16-byte record at word `i`, or null for an unknown type. */
export function decodeEvent(w: Uint32Array, f: Float32Array, i: number): CoreEvent | null {
  switch (w[i]) {
    case Event.WINDOW_READY: return { type: "windowReady", width: w[i + 1], height: w[i + 2], scale: f[i + 3] };
    case Event.RESIZED: return { type: "resized", width: w[i + 1], height: w[i + 2] };
    case Event.POINTER_MOVE: return { type: "pointerMove", x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_DOWN: return { type: "pointerDown", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_UP: return { type: "pointerUp", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.KEY_DOWN: return { type: "keyDown", key: keyName(w[i + 1]), repeat: w[i + 2] !== 0 };
    case Event.KEY_UP: return { type: "keyUp", key: keyName(w[i + 1]) };
    case Event.CLOSE_REQUESTED: return { type: "closeRequested" };
    case Event.SCALE_CHANGED: return { type: "scaleChanged", scale: f[i + 3] };
    case Event.PRESS: return { type: "press", target: w[i + 1], x: f[i + 2], y: f[i + 3] };
    default: return null;
  }
}

/** Reads every queued event of an instance: `take` fills the buffer and returns bytes written. */
export class EventReader {
  private buf = new Uint8Array(64 * 1024);
  private u32 = new Uint32Array(this.buf.buffer);
  private f32 = new Float32Array(this.buf.buffer);

  drain(take: (buf: Uint8Array) => number, each: (e: CoreEvent) => void) {
    for (;;) {
      const n = take(this.buf);
      for (let i = 0; i < n / 4; i += 4) {
        const e = decodeEvent(this.u32, this.f32, i);
        if (e) each(e);
      }
      if (n < this.buf.byteLength) break;
    }
  }
}
