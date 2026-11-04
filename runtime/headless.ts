// Headless instances of the native core, for tests (design §12.2): the real
// tree, layout, hit-testing and renderer, with no window and no Worker. Every
// call runs synchronously on the caller's thread, and time only moves when the
// test says so, so tests are deterministic.
import { openCore, type CoreLib } from "./ffi";
import { EventReader, route, STAT_NAMES, statsFrom, type CoreEvent, type Stats } from "./events";
import { KeyModifier, NamedKey, StyleProp } from "./gen/protocol";
import { Ui, type Node } from "./ui";

export type { CoreEvent, Stats } from "./events";

export interface HeadlessOptions {
  /** Logical size. Default 640 × 400. */
  width?: number;
  height?: number;
  /** Scale factor (device pixels per logical pixel). Default 1. */
  scale?: number;
}

export interface Capture {
  /** Device pixels. */
  width: number;
  height: number;
  /** RGBA8, sRGB, top row first. */
  pixels: Uint8Array;
  /** The pixel at logical (x, y) as [r, g, b, a]. */
  at(x: number, y: number): [number, number, number, number];
}

let shared: CoreLib | null = null;

export interface KeyMods {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  /** The platform's shortcut key: Command on macOS, Control elsewhere. */
  primary?: boolean;
}

const utf8 = new TextEncoder();
const isMac = process.platform === "darwin";

/** UTF-8 bytes for FFI, or null for an empty string (bun:ffi takes no empty buffers). */
function bytes(s: string): Uint8Array | null {
  return s ? utf8.encode(s) : null;
}

export class HeadlessCore {
  readonly lib: CoreLib = (shared ??= openCore());
  readonly handle: number;
  readonly ui: Ui;
  /** Events delivered so far, by type. */
  readonly received: Record<string, number> = {};
  onEvent: (e: CoreEvent) => void = () => {};

  private events = new EventReader();
  private scale: number;
  private freed = false;

  constructor(options: HeadlessOptions = {}) {
    const { width = 640, height = 400, scale = 1 } = options;
    this.scale = scale;
    this.handle = this.lib.symbols.mt_headless_new(Math.round(width * scale), Math.round(height * scale), scale);
    if (!this.handle) throw new Error("mantou: could not create a headless instance");
    this.ui = new Ui({
      commit: (bytes) => {
        const r = this.lib.symbols.mt_commit(this.handle, bytes, bytes.byteLength);
        if (r !== 0) throw new Error(`mantou: the core rejected a batch (${r})`);
      },
      service: (req, json) => {
        const b = utf8.encode(json);
        this.lib.symbols.mt_service(this.handle, req, b, b.byteLength);
      },
      rect: (id) => {
        const r = new Float32Array(4);
        return this.lib.symbols.mt_test_node_rect(this.handle, id, r) === 0 ? [r[0], r[1], r[2], r[3]] : null;
      },
      selection: (id) => {
        const r = new Uint32Array(2);
        return this.lib.symbols.mt_input_selection(this.handle, id, r) === 0 ? [r[0], r[1]] : null;
      },
    });
    this.ui.dispatchResize(width, height, scale);
  }

  /**
   * Commits pending ops, advances the clock by `ms`, and delivers events,
   * repeating until nothing is left: handlers' ops are committed too.
   */
  step(ms = 0): this {
    for (let round = 0; round < 100; round++) {
      this.ui.flush();
      const flags = this.lib.symbols.mt_test_step(this.handle, ms);
      ms = 0;
      if (!(flags & 1) && this.ui.enc.empty) return this;
      this.events.drain(
        (buf) => this.lib.symbols.mt_take_events(this.handle, buf, buf.byteLength),
        (e) => {
          this.received[e.type] = (this.received[e.type] ?? 0) + 1;
          route(this.ui, e);
          this.onEvent(e);
        },
      );
    }
    throw new Error("mantou: the instance did not settle after 100 rounds (a handler keeps changing the UI?)");
  }

  /** Pointer input at logical (x, y), then step. */
  pointer(kind: "down" | "up" | "move", x: number, y: number): this {
    this.ui.flush();
    this.lib.symbols.mt_test_input(this.handle, kind === "down" ? 0 : kind === "up" ? 1 : 2, x, y);
    return this.step();
  }

  /** Moves the pointer to logical (x, y), or over the centre of a node, then step. */
  hover(target: Node | [number, number]): this {
    const [x, y] = Array.isArray(target) ? target : this.center(target);
    return this.pointer("move", x, y);
  }

  /** The pointer leaves the window, then step. */
  unhover(): this {
    this.ui.flush();
    this.lib.symbols.mt_test_input(this.handle, 3, 0, 0);
    return this.step();
  }

  /** The cursor the pointer shows now ("default", "pointer", "text"…). */
  cursor(): string {
    return StyleProp.cursor.values[this.lib.symbols.mt_test_cursor(this.handle)];
  }

  /** A secondary or middle button (1 middle, 2 secondary) going down or up at logical (x, y), then step. */
  pointerButton(kind: "down" | "up", button: 1 | 2, x: number, y: number): this {
    this.ui.flush();
    this.lib.symbols.mt_test_button(this.handle, kind === "down" ? 0 : 1, button, x, y);
    return this.step();
  }

  /** Presses (down + up) at logical (x, y), or at the centre of a node. */
  press(target: Node | [number, number]): this {
    const [x, y] = Array.isArray(target) ? target : this.center(target);
    this.pointer("down", x, y);
    return this.pointer("up", x, y);
  }

  /**
   * Presses and releases a key. `key` is a character or a named key
   * ("ArrowDown"…). A character types itself into the focused Input, unless
   * a shortcut modifier is held.
   */
  key(key: string, mods: KeyMods = {}): this {
    const code = [...key].length === 1 ? key.codePointAt(0)! : (NamedKey as Record<string, number>)[key];
    if (code === undefined) throw new Error(`mantou: unknown key "${key}"`);
    const ctrl = mods.ctrl || (mods.primary && !isMac), meta = mods.meta || (mods.primary && isMac);
    const bits = (mods.shift ? KeyModifier.Shift : 0) | (ctrl ? KeyModifier.Control : 0) | (mods.alt ? KeyModifier.Alt : 0) | (meta ? KeyModifier.Meta : 0);
    this.ui.flush();
    this.lib.symbols.mt_test_key(this.handle, code, 1, bits);
    this.lib.symbols.mt_test_key(this.handle, code, 0, bits);
    return this.step();
  }

  /** Types `text` key by key into the focused Input, as a keyboard would ("\n" presses Enter). */
  type(text: string): this {
    for (const ch of text) this.key(ch === "\n" ? "Enter" : ch);
    return this;
  }

  /** Text arriving all at once, as from an IME or dictation (one undo step). */
  insertText(text: string): this {
    this.ui.flush();
    const b = bytes(text);
    this.lib.symbols.mt_test_text(this.handle, b, b?.byteLength ?? 0);
    return this.step();
  }

  /** An IME composition in progress in the focused Input ("" ends it); `cursor` is a byte range in it. */
  compose(text: string, cursor?: [number, number]): this {
    this.ui.flush();
    const b = bytes(text);
    const none = 0xffffffff;
    this.lib.symbols.mt_test_ime(this.handle, b, b?.byteLength ?? 0, cursor?.[0] ?? none, cursor?.[1] ?? none);
    return this.step();
  }

  /** The instance's own clipboard (copy, cut and paste in Inputs use it). */
  get clipboard(): string {
    return this.readString((buf) => this.lib.symbols.mt_test_clipboard(this.handle, buf, buf.byteLength)) ?? "";
  }

  set clipboard(text: string) {
    const b = bytes(text);
    this.lib.symbols.mt_test_set_clipboard(this.handle, b, b?.byteLength ?? 0);
  }

  /** An Input's text as the core has it, or null if the node isn't an Input. */
  value(node: Node): string | null {
    this.step();
    return this.readString((buf) => this.lib.symbols.mt_test_value(this.handle, node.id, buf, buf.byteLength));
  }

  /** The Input with the keyboard focus, as the core has it. */
  focused(): Node | null {
    this.step();
    return this.ui.nodes.get(this.lib.symbols.mt_test_focused(this.handle)) ?? null;
  }

  /** Calls `read` (which returns the full length, or 0xffffffff for none) with a big enough buffer. */
  private readString(read: (buf: Uint8Array) => number): string | null {
    let buf = new Uint8Array(1024);
    let n = read(buf);
    if (n === 0xffffffff) return null;
    if (n > buf.byteLength) {
      buf = new Uint8Array(n);
      n = read(buf);
    }
    return new TextDecoder().decode(buf.subarray(0, n));
  }

  /** Scrolls the wheel at logical (x, y); positive dy scrolls content up. */
  wheel(x: number, y: number, dy: number, dx = 0): this {
    this.ui.flush();
    this.lib.symbols.mt_test_wheel(this.handle, x, y, dx, dy);
    return this.step();
  }

  /** The node's laid-out box [x0, y0, x1, y1] in logical px, or null. */
  rect(node: Node): [number, number, number, number] | null {
    this.step();
    const r = new Float32Array(4);
    return this.lib.symbols.mt_test_node_rect(this.handle, node.id, r) === 0 ? [r[0], r[1], r[2], r[3]] : null;
  }

  center(node: Node): [number, number] {
    const r = this.rect(node);
    if (!r) throw new Error(`mantou: node ${node.id} is not laid out`);
    return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  }

  /** The topmost node at logical (x, y). */
  hit(x: number, y: number): Node | null {
    this.step();
    return this.ui.nodes.get(this.lib.symbols.mt_test_hit(this.handle, x, y)) ?? null;
  }

  /** Resizes the viewport (logical px). */
  resize(width: number, height: number, scale = this.scale): this {
    this.ui.flush();
    this.scale = scale;
    this.lib.symbols.mt_test_viewport(this.handle, Math.round(width * scale), Math.round(height * scale), scale);
    return this.step();
  }

  /** The latest scene as text: `size`, `clear`, then one `quad x0 y0 x1 y1 #rrggbbaa` per rectangle. */
  scene(): string {
    this.step();
    let buf = new Uint8Array(4096);
    let n = this.lib.symbols.mt_test_scene(this.handle, buf, buf.byteLength);
    if (n > buf.byteLength) {
      buf = new Uint8Array(n);
      n = this.lib.symbols.mt_test_scene(this.handle, buf, buf.byteLength);
    }
    return new TextDecoder().decode(buf.subarray(0, n));
  }

  /** Renders the latest scene offscreen (needs a GPU adapter; a software one is fine). */
  capture(): Capture {
    this.step();
    const [, w, h] = /^size (\d+)x(\d+)/.exec(this.scene())!.map(Number);
    const pixels = new Uint8Array(w * h * 4);
    const r = this.lib.symbols.mt_test_capture(this.handle, pixels, pixels.byteLength);
    if (r === -1) throw new Error("mantou: no GPU adapter for offscreen rendering (on Linux, install Mesa's lavapipe)");
    if (r < 0) throw new Error(`mantou: capture failed (${r})`);
    const scale = this.scale;
    return {
      width: w,
      height: h,
      pixels,
      at(x, y) {
        const px = Math.floor(x * scale), py = Math.floor(y * scale);
        const i = (py * w + px) * 4;
        return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      },
    };
  }

  stats(): Stats {
    const a = new BigUint64Array(STAT_NAMES.length);
    this.lib.symbols.mt_stats(this.handle, a, a.length);
    return statsFrom(a);
  }

  /**
   * Queues the answer to the next platform service request (a dialog, a
   * context menu…): the paths of openFile, the index of message's button…
   * `null` cancels it. Unanswered requests are cancelled.
   */
  answer(value: unknown | null): this {
    const b = value === null ? null : utf8.encode(JSON.stringify(value));
    this.lib.symbols.mt_test_answer(this.handle, b, b?.byteLength ?? 0);
    return this;
  }

  /** The last platform service request, as the core got it. */
  lastService(): ({ kind: string } & Record<string, unknown>) | null {
    const buf = new Uint8Array(64 * 1024);
    const n = this.lib.symbols.mt_test_service(this.handle, buf, buf.byteLength);
    return n ? JSON.parse(new TextDecoder().decode(buf.subarray(0, Math.min(n, buf.byteLength)))) : null;
  }

  /** The accessibility tree as indented text, one node per line: `Role "name" value="…" state`. */
  accessibility(): string {
    this.ui.flush();
    const buf = new Uint8Array(256 * 1024);
    const n = this.lib.symbols.mt_test_access(this.handle, buf, buf.byteLength);
    return new TextDecoder().decode(buf.subarray(0, Math.min(n, buf.byteLength)));
  }

  /** The user chooses the app-menu item `id`; then steps. */
  chooseMenu(id: string): this {
    const b = utf8.encode(id);
    this.lib.symbols.mt_test_menu(this.handle, b, b.byteLength);
    return this.step();
  }

  /** Frees the instance in the core. */
  free() {
    if (this.freed) return;
    this.freed = true;
    this.lib.symbols.mt_headless_free(this.handle);
  }
}
