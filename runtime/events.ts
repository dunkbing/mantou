// Decodes the core's event records and counters, shared by the window client
// (core.ts) and headless instances (headless.ts).
import { Event, KeyModifier, NamedKey } from "./gen/protocol";

export type CoreEvent =
  | { type: "windowReady"; width: number; height: number; scale: number }
  | { type: "resized"; width: number; height: number; scale: number }
  | { type: "pointerMove"; x: number; y: number }
  | { type: "pointerDown" | "pointerUp"; button: number; x: number; y: number }
  | ({ type: "keyDown"; repeat: boolean } & KeyInfo)
  | ({ type: "keyUp" } & KeyInfo)
  | { type: "closeRequested" }
  | { type: "scaleChanged"; scale: number }
  | { type: "press"; target: number; x: number; y: number }
  | { type: "wheel"; target: number; dx: number; dy: number }
  | { type: "layout"; target: number; x: number; y: number; width: number; height: number }
  | { type: "scroll"; target: number; x: number; y: number }
  | { type: "imageLoad"; target: number; width: number; height: number }
  | { type: "imageError"; target: number; message: string }
  | { type: "animationEnd"; target: number; animation: number }
  | { type: "pointerEnter" | "pointerLeave"; target: number }
  | { type: "serviceResult"; req: number; cancelled: boolean; json: string }
  | { type: "menu"; id: string }
  | InputCoreEvent;

/** What the core says about Input nodes. */
export type InputCoreEvent =
  | { type: "focus" | "blur" | "submit"; target: number }
  | { type: "textChanged"; target: number; rev: number; text: string };

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
  /** Scenes built (an unchanged tree builds none). */
  scenes: number;
  /** Text layouts computed, not reused from a node or the cache. */
  textLayouts: number;
}
export const STAT_NAMES: (keyof Stats)[] = ["frames", "commits", "wakes", "events", "resizes", "redrawRequests", "layouts", "ops", "opErrors", "quads", "nodes", "presses", "glyphs", "scenes", "textLayouts"];

export function statsFrom(a: BigUint64Array): Stats {
  return Object.fromEntries(STAT_NAMES.map((k, i) => [k, Number(a[i])])) as unknown as Stats;
}

const NAMES = new Map<number, string>(Object.entries(NamedKey).map(([k, v]) => [v, k]));

function keyInfo(code: number, mods: number): KeyInfo {
  const key = code >= 0x110000 ? (NAMES.get(code) ?? "Unidentified") : String.fromCodePoint(code);
  return { key, shift: !!(mods & KeyModifier.Shift), ctrl: !!(mods & KeyModifier.Control), alt: !!(mods & KeyModifier.Alt), meta: !!(mods & KeyModifier.Meta) };
}

const utf8 = new TextDecoder();

/** The UTF-8 text after a record's four words: `len` bytes, within the record's extra words. */
function text(w: Uint32Array, i: number, len: number): string {
  return utf8.decode(new Uint8Array(w.buffer, (i + 4) * 4, Math.min(len, (w[i] >>> 16) * 4)));
}

/** Decodes the record at word `i`, or null for an unknown type. */
export function decodeEvent(w: Uint32Array, f: Float32Array, i: number): CoreEvent | null {
  switch (w[i] & 0xffff) {
    case Event.WINDOW_READY: return { type: "windowReady", width: w[i + 1], height: w[i + 2], scale: f[i + 3] };
    case Event.RESIZED: return { type: "resized", width: w[i + 1], height: w[i + 2], scale: f[i + 3] };
    case Event.POINTER_MOVE: return { type: "pointerMove", x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_DOWN: return { type: "pointerDown", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.POINTER_UP: return { type: "pointerUp", button: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.KEY_DOWN: return { type: "keyDown", repeat: w[i + 2] !== 0, ...keyInfo(w[i + 1], w[i + 3]) };
    case Event.KEY_UP: return { type: "keyUp", ...keyInfo(w[i + 1], w[i + 3]) };
    case Event.CLOSE_REQUESTED: return { type: "closeRequested" };
    case Event.SCALE_CHANGED: return { type: "scaleChanged", scale: f[i + 3] };
    case Event.PRESS: return { type: "press", target: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.WHEEL: return { type: "wheel", target: w[i + 1], dx: f[i + 2], dy: f[i + 3] };
    case Event.IMAGE_LOAD: return { type: "imageLoad", target: w[i + 1], width: f[i + 2], height: f[i + 3] };
    case Event.IMAGE_ERROR: return { type: "imageError", target: w[i + 1], message: utf8.decode(new Uint8Array(w.buffer, (i + 4) * 4, Math.min(w[i + 3], (w[i] >>> 16) * 4))) };
    case Event.POINTER_ENTER: return { type: "pointerEnter", target: w[i + 1] };
    case Event.POINTER_LEAVE: return { type: "pointerLeave", target: w[i + 1] };
    case Event.ANIMATION_END: return { type: "animationEnd", target: w[i + 1], animation: w[i + 2] };
    case Event.SCROLL: return { type: "scroll", target: w[i + 1], x: f[i + 2], y: f[i + 3] };
    case Event.LAYOUT: return { type: "layout", target: w[i + 1], x: f[i + 2], y: f[i + 3], width: f[i + 4], height: f[i + 5] };
    case Event.SERVICE_RESULT: return { type: "serviceResult", req: w[i + 1], cancelled: w[i + 2] !== 0, json: text(w, i, w[i + 3]) };
    case Event.MENU: return { type: "menu", id: text(w, i, w[i + 3]) };
    case Event.FOCUS: return { type: "focus", target: w[i + 1] };
    case Event.BLUR: return { type: "blur", target: w[i + 1] };
    case Event.SUBMIT: return { type: "submit", target: w[i + 1] };
    case Event.TEXT_CHANGED: return { type: "textChanged", target: w[i + 1], rev: w[i + 2], text: text(w, i, w[i + 3]) };
    default: return null;
  }
}

/** Reads every queued event of an instance: `take` fills the buffer and returns bytes written. */
export class EventReader {
  private buf = new Uint8Array(64 * 1024);
  private u32 = new Uint32Array(this.buf.buffer);
  private f32 = new Float32Array(this.buf.buffer);

  /** Takes records until none are left (mt_take_events: 0 = none, 0x80000000 | size = buffer too small). */
  drain(take: (buf: Uint8Array) => number, each: (e: CoreEvent) => void) {
    for (;;) {
      const n = take(this.buf);
      if (n === 0) return;
      if (n >= 0x80000000) {
        this.buf = new Uint8Array(Math.max(this.buf.byteLength * 2, n - 0x80000000));
        this.u32 = new Uint32Array(this.buf.buffer);
        this.f32 = new Float32Array(this.buf.buffer);
        continue;
      }
      for (let i = 0; i < n / 4; i += 4 + (this.u32[i] >>> 16)) {
        const e = decodeEvent(this.u32, this.f32, i);
        if (e) each(e);
      }
    }
  }
}

/** What every core client does with an event before the app sees it. */
export function route(
  ui: {
    dispatchPress(t: number, x: number, y: number): void;
    dispatchWheel(t: number, dx: number, dy: number): void;
    dispatchKey(e: KeyInfo & { type: "keyDown" | "keyUp"; repeat?: boolean }): void;
    dispatchInput(e: InputCoreEvent): void;
    dispatchLayout(t: number, rect: { x: number; y: number; width: number; height: number }): void;
    dispatchResize(width: number, height: number, scale: number): void;
    dispatchScroll(t: number, x: number, y: number): void;
    dispatchImage(t: number, result: { width: number; height: number } | { error: string }): void;
    dispatchAnimationEnd(animation: number): void;
    dispatchHover(t: number, hovered: boolean): void;
    dispatchService(req: number, cancelled: boolean, json: string): void;
    dispatchMenu(id: string): void;
    readonly windowSize: { scale: number } | null;
  },
  e: CoreEvent,
) {
  if (e.type === "press") ui.dispatchPress(e.target, e.x, e.y);
  else if (e.type === "scroll") ui.dispatchScroll(e.target, e.x, e.y);
  else if (e.type === "imageLoad") ui.dispatchImage(e.target, { width: e.width, height: e.height });
  else if (e.type === "imageError") ui.dispatchImage(e.target, { error: e.message });
  else if (e.type === "animationEnd") ui.dispatchAnimationEnd(e.animation);
  else if (e.type === "pointerEnter" || e.type === "pointerLeave") ui.dispatchHover(e.target, e.type === "pointerEnter");
  else if (e.type === "serviceResult") ui.dispatchService(e.req, e.cancelled, e.json);
  else if (e.type === "menu") ui.dispatchMenu(e.id);
  else if (e.type === "layout") ui.dispatchLayout(e.target, { x: e.x, y: e.y, width: e.width, height: e.height });
  // Sizes arrive in device px; the app works in logical px.
  else if (e.type === "windowReady") ui.dispatchResize(e.width / e.scale, e.height / e.scale, e.scale);
  else if (e.type === "resized") {
    const scale = e.scale || ui.windowSize?.scale || 1;
    ui.dispatchResize(e.width / scale, e.height / scale, scale);
  }
  else if (e.type === "focus" || e.type === "blur" || e.type === "submit" || e.type === "textChanged") ui.dispatchInput(e);
  else if (e.type === "wheel") ui.dispatchWheel(e.target, e.dx, e.dy);
  else if (e.type === "keyDown" || e.type === "keyUp") ui.dispatchKey(e);
}
