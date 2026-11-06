// Looking at motion headless: a contact sheet of frames (one image an agent or a reviewer can read), and a
// check that plays an interaction on the core's clock and reports motion that looks broken.
import type { HeadlessCore, Target } from "./headless";
import type { Image } from "./png";

export interface StripOptions {
  /** How many frames (default 12), and the clock between them in ms (default 33: about 30 a second). */
  frames?: number;
  every?: number;
  /** Frames per row (default 4). */
  cols?: number;
  /** Only this part of each frame: [x, y, width, height] in logical px. */
  crop?: [number, number, number, number];
}

/**
 * Steps the clock `every` ms `frames` times, capturing each frame, and lays the frames out in a grid, left to
 * right then down, with a gap between them: an animation in one image. The first frame is now.
 */
export function captureStrip(h: HeadlessCore, options: StripOptions = {}): Image {
  const { frames = 12, every = 33, cols = 4 } = options;
  const shots: Image[] = [];
  for (let i = 0; i < frames; i++) {
    if (i > 0) h.step(every);
    const c = h.capture();
    shots.push(options.crop ? crop(c, options.crop, c.width / (h.ui.windowSize?.width || c.width)) : c);
  }
  const gap = 4;
  const [w, hh] = [shots[0].width, shots[0].height];
  const rows = Math.ceil(frames / cols);
  const width = cols * w + (cols - 1) * gap, height = rows * hh + (rows - 1) * gap;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([24, 24, 27, 255], i);
  shots.forEach((s, i) => {
    const ox = (i % cols) * (w + gap), oy = Math.floor(i / cols) * (hh + gap);
    for (let y = 0; y < hh; y++) pixels.set(s.pixels.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, pixels };
}

function crop(img: Image, [x, y, w, h]: [number, number, number, number], scale: number): Image {
  const [px, py] = [Math.max(0, Math.round(x * scale)), Math.max(0, Math.round(y * scale))];
  const [pw, ph] = [Math.min(img.width - px, Math.round(w * scale)), Math.min(img.height - py, Math.round(h * scale))];
  const pixels = new Uint8Array(pw * ph * 4);
  for (let r = 0; r < ph; r++) pixels.set(img.pixels.subarray(((py + r) * img.width + px) * 4, ((py + r) * img.width + px + pw) * 4), r * pw * 4);
  return { width: pw, height: ph, pixels };
}

export interface MotionFinding {
  /**
   * `jump`: an animating box's speed changed abruptly between two frames (a restart from rest, a snap
   * mid-flight); `flicker`: its opacity went down and up again (or up and down) more than once;
   * `never-settles`: still animating when the check ended.
   */
  kind: "jump" | "flicker" | "never-settles";
  /** The node: its testId, else `Kind#id`. */
  node: string;
  /** ms after the interaction. */
  at: number;
  detail: string;
}

export interface MotionCheckOptions {
  /** How long to watch (default 1000 ms) and the frame length (default 16 ms). */
  ms?: number;
  frame?: number;
  /** testIds (or `Kind#id`s) allowed to keep animating, such as spinners. */
  allow?: (string | Target)[];
}

/**
 * Runs `act` (an interaction: a press, a state change), then plays the clock frame by frame for `ms`,
 * watching every box as drawn, and returns what looks broken: abrupt jumps in an animation, flicker, and
 * animations that never settle. An empty list means the motion is clean.
 */
export function checkMotion(h: HeadlessCore, act: () => void = () => {}, options: MotionCheckOptions = {}): MotionFinding[] {
  const { ms = 1000, frame = 16 } = options;
  const name = (id: number) => {
    const n = h.ui.nodes.get(id);
    return n?.testId ?? `${n?.kindName ?? "Node"}#${id}`;
  };
  const allowed = new Set((options.allow ?? []).map((a) => (typeof a === "string" ? a : Array.isArray(a) ? "" : name(a.id))));
  type Track = { last?: [number, number, number, number]; velocity?: [number, number]; opacity: number[]; jumped?: boolean };
  const tracks = new Map<number, Track>();
  const findings: MotionFinding[] = [];
  act();
  h.step();
  let animating: number[] = [];
  for (let t = 0; t <= ms; t += frame) {
    if (t > 0) h.step(frame);
    const boxes = h.presented();
    animating = [];
    for (const [id, b] of boxes) {
      const tr = tracks.get(id) ?? { opacity: [] };
      tracks.set(id, tr);
      const r = b.rect as [number, number, number, number];
      if (b.animating) animating.push(id);
      if (tr.last) {
        const v: [number, number] = [(r[0] + r[2] - tr.last[0] - tr.last[2]) / 2, (r[1] + r[3] - tr.last[1] - tr.last[3]) / 2];
        if (b.animating && tr.velocity && !tr.jumped) {
          const dv = Math.hypot(v[0] - tr.velocity[0], v[1] - tr.velocity[1]);
          const size = Math.max(r[2] - r[0], r[3] - r[1]);
          if (dv > Math.max(24, size * 0.5)) {
            tr.jumped = true;
            findings.push({ kind: "jump", node: name(id), at: t, detail: `its speed changed by ${Math.round(dv)} px in one ${frame} ms frame` });
          }
        }
        tr.velocity = v;
      }
      tr.last = r;
      tr.opacity.push(b.opacity);
    }
  }
  for (const [id, tr] of tracks) {
    let turns = 0, dir = 0, from = tr.opacity[0];
    for (const o of tr.opacity) {
      const d = o - from;
      if (Math.abs(d) < 0.15) continue;
      const s = Math.sign(d);
      if (dir !== 0 && s !== dir) turns++;
      dir = s;
      from = o;
    }
    if (turns >= 2 && !allowed.has(name(id))) findings.push({ kind: "flicker", node: name(id), at: 0, detail: `its opacity changed direction ${turns} times` });
  }
  for (const id of animating) if (!allowed.has(name(id))) findings.push({ kind: "never-settles", node: name(id), at: ms, detail: `still animating after ${ms} ms` });
  // An animating box's children move with it: report the outermost.
  return findings.filter((f, i) => !(f.kind === "never-settles" && findings.some((g, j) => j !== i && g.kind === "never-settles" && isAncestor(h, g.node, f.node))));
}

function isAncestor(h: HeadlessCore, a: string, b: string): boolean {
  const node = (s: string) => [...h.ui.nodes.values()].find((n) => (n.testId ?? `${n.kindName}#${n.id}`) === s);
  const na = node(a);
  for (let n = node(b)?.parent; n; n = n.parent) if (n === na) return true;
  return false;
}
