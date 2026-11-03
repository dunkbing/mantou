// Decodes the core's event records and counters, shared by the window client
// (core.ts) and headless instances (headless.ts).
import { Event, KeyModifier, NamedKey } from "./gen/protocol";

export type CoreEvent =
  | { type: "windowReady"; width: number; height: number; scale: number }
  | { type: "resized"; width: number; height: number }
  | { type: "pointerMove"; x: number; y: number }
  | { type: "pointerDown" | "pointerUp"; button: number; x: number; y: number }
  | ({ type: "keyDown"; repeat: boolean } & KeyInfo)
  | ({ type: "keyUp" } & KeyInfo)
  | { type: "closeRequested" }
  | { type: "scaleChanged"; scale: number }
  | { type: "press"; target: number; x: number; y: number }
  | { type: "wheel"; target: number; dx: number; dy: number };

export interface KeyInfo {
  /** A character ("j", "J", " ") or a named key ("ArrowDown", "Enter", "Escape"…). */
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

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
  glyphs: number;
}
export const STAT_NAMES: (keyof Stats)[] = ["frames", "commits", "wakes", "events", "resizes", "redrawRequests", "layouts", "ops", "opErrors", "quads", "nodes", "presses", "glyphs"];

export function statsFrom(a: BigUint64Array): Stats {
  return Object.fromEntries(STAT_NAMES.map((k, i) => [k, Number(a[i])])) as unknown as Stats;
}

const NAMES = new Map<number, string>(Object.entries(NamedKey).map(([k, v]) => [v, k]));

function keyInfo(code: number, mods: number): KeyInfo {
  const key = code >= 0x110000 ? (NAMES.get(code) ?? "Unidentified") : String.fromCodePoint(code);
  return { key, shift: !!(mods & KeyModifier.Shift), ctrl: !!(mods & KeyModifier.Control), alt: !!(mods & KeyModifier.Alt), meta: !!(mods & KeyModifier.Meta) };
}

/** Decodes the 16-byte record at word `i`, or null for an unknown type. */
export function decodeEvent(w: Uint32Array, f: Float32Array, i: number): CoreEvent | null {
  switch (w[i]) {
    case Event.WINDOW_READY: return { type: "windowReady", width: w[i + 1], height: w[i + 2], scale: f[i + 3] };
    case Event.RESIZED: return { type: "resized", width: w[i + 1], height: w[i + 2] };
    case Event.POINTER_MOVE: return { type: "pointerMove", x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_DOWN: return { type: "pointerDown", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_UP: return { type: "pointerUp", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.KEY_DOWN: return { type: "keyDown", repeat: w[i + 2] !== 0, ...keyInfo(w[i + 1], w[i + 3]) };
    case Event.KEY_UP: return { type: "keyUp", ...keyInfo(w[i + 1], w[i + 3]) };
    case Event.CLOSE_REQUESTED: return { type: "closeRequested" };
    case Event.SCALE_CHANGED: return { type: "scaleChanged", scale: f[i + 3] };
    case Event.PRESS: return { type: "press", target: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.WHEEL: return { type: "wheel", target: w[i + 1], dx: f[i + 2], dy: f[i + 3] };
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

/** What every core client does with an event before the app sees it. */
export function route(ui: { dispatchPress(t: number, x: number, y: number): void; dispatchWheel(t: number, dx: number, dy: number): void; dispatchKey(e: KeyInfo & { type: "keyDown" | "keyUp"; repeat?: boolean }): void }, e: CoreEvent) {
  if (e.type === "press") ui.dispatchPress(e.target, e.x, e.y);
  else if (e.type === "wheel") ui.dispatchWheel(e.target, e.dx, e.dy);
  else if (e.type === "keyDown" || e.type === "keyUp") ui.dispatchKey(e);
}
