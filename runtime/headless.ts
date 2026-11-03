// Headless instances of the native core, for tests (design §12.2): the real
// tree, layout, hit-testing and renderer, with no window and no Worker. Every
// call runs synchronously on the caller's thread, and time only moves when the
// test says so, so tests are deterministic.
import { openCore, type CoreLib } from "./ffi";
import { EventReader, STAT_NAMES, statsFrom, type CoreEvent, type Stats } from "./events";
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
    });
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
          if (e.type === "press") this.ui.dispatchPress(e.target, e.x, e.y);
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

  /** Presses (down + up) at logical (x, y), or at the centre of a node. */
  press(target: Node | [number, number]): this {
    const [x, y] = Array.isArray(target) ? target : this.center(target);
    this.pointer("down", x, y);
    return this.pointer("up", x, y);
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

  /** Frees the instance in the core. */
  free() {
    if (this.freed) return;
    this.freed = true;
    this.lib.symbols.mt_headless_free(this.handle);
  }
}
