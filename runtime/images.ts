// Reference-image tests (design §12): compare a headless capture with a
// committed PNG, pixel by pixel, with a tolerance for the small differences
// between GPU backends (lavapipe, WARP, Metal rasterize edges a little
// differently).
//
//   import "mantou-ui/images";       // registers toMatchImage with bun:test
//   expect(h.capture()).toMatchImage("counter");
//
// Goldens live in `tests/images/<name>.png` (or MANTOU_IMAGES). With
// MANTOU_UPDATE_IMAGES=1 the matcher writes them instead of comparing; a
// missing golden is written too, except in CI (CI=true), where it fails.
// On a mismatch it writes `<name>.actual.png` and `<name>.diff.png` under
// `__failures__/` next to the goldens.
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

/** An RGBA8 image, top row first (what `HeadlessCore.capture()` returns has these fields). */
export interface Image {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface MatchOptions {
  /** A pixel differs when a channel differs by more than this (0–255). Default 24. */
  threshold?: number;
  /** The share of pixels allowed to differ (0–1). Default 0.002, so 0.2%. */
  maxDiffRatio?: number;
}

export interface Comparison {
  /** Pixels whose largest channel difference is over the threshold. */
  differing: number;
  ratio: number;
  /** The largest channel difference anywhere. */
  maxDelta: number;
  /** The second image with differing pixels in red and the rest faded, for looking at. */
  diff: Image;
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes RGBA8 pixels as a PNG (each row filtered with "up", which suits flat UI). */
export function encodePng(img: Image): Uint8Array {
  const { width: w, height: h, pixels } = img;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = y === 0 ? 0 : 2;
    for (let x = 0; x < stride; x++) {
      const v = pixels[y * stride + x];
      raw[row + 1 + x] = y === 0 ? v : (v - pixels[(y - 1) * stride + x]) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Decodes an 8-bit RGBA, non-interlaced PNG (what encodePng writes). */
export function decodePng(bytes: Uint8Array): Image {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error("mantou: not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      w = view.getUint32(at + 8);
      h = view.getUint32(at + 12);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("mantou: only 8-bit RGBA, non-interlaced PNGs are supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const pixels = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[dst + x - 4] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[dst - stride + x - 4] : 0;
      let p = raw[src + x];
      if (filter === 1) p += a;
      else if (filter === 2) p += b;
      else if (filter === 3) p += (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c, pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[dst + x] = p & 255;
    }
  }
  return { width: w, height: h, pixels };
}

/** Compares two images of the same size. */
export function compareImages(expected: Image, actual: Image, threshold = 24): Comparison {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`mantou: image sizes differ: ${expected.width}×${expected.height} vs ${actual.width}×${actual.height}`);
  }
  const n = actual.width * actual.height;
  const diff = new Uint8Array(n * 4);
  let differing = 0, maxDelta = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(expected.pixels[i * 4 + c] - actual.pixels[i * 4 + c]));
    maxDelta = Math.max(maxDelta, d);
    if (d > threshold) {
      differing++;
      diff.set([255, 0, 0, 255], i * 4);
    } else {
      const g = 255 - ((255 - actual.pixels[i * 4]) >> 2); // faded, so the red stands out
      diff.set([g, g, g, 255], i * 4);
    }
  }
  return { differing, ratio: differing / n, maxDelta, diff: { width: actual.width, height: actual.height, pixels: diff } };
}

/** Where a golden lives: an absolute path as is, else `<MANTOU_IMAGES or tests/images>/<name>.png`. */
export function goldenPath(name: string): string {
  if (isAbsolute(name)) return name.endsWith(".png") ? name : `${name}.png`;
  return join(process.env.MANTOU_IMAGES ?? join(process.cwd(), "tests", "images"), `${name}.png`);
}

function write(path: string, img: Image) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img));
}

declare module "bun:test" {
  interface Matchers<T> {
    /** The image matches the golden `name` (see mantou-ui/images). */
    toMatchImage(name: string, options?: MatchOptions): void;
  }
}

expect.extend({
  toMatchImage(received: unknown, name: string, options: MatchOptions = {}) {
    const img = received as Image;
    const path = goldenPath(name);
    const update = process.env.MANTOU_UPDATE_IMAGES === "1";
    if (update || (!existsSync(path) && !process.env.CI)) {
      write(path, img);
      return { pass: true, message: () => `wrote ${path}` };
    }
    if (!existsSync(path)) return { pass: false, message: () => `no golden at ${path}; run with MANTOU_UPDATE_IMAGES=1 to write it` };
    const golden = decodePng(new Uint8Array(readFileSync(path)));
    if (golden.width !== img.width || golden.height !== img.height) {
      return { pass: false, message: () => `${name}: ${img.width}×${img.height}, but the golden is ${golden.width}×${golden.height}` };
    }
    const { threshold = 24, maxDiffRatio = 0.002 } = options;
    const c = compareImages(golden, img, threshold);
    const pass = c.ratio <= maxDiffRatio;
    if (!pass) {
      const failures = join(dirname(path), "__failures__");
      write(join(failures, `${name}.actual.png`), img);
      write(join(failures, `${name}.diff.png`), c.diff);
    }
    const summary = `${c.differing} pixels (${(c.ratio * 100).toFixed(3)}%) differ by more than ${threshold}; the largest difference is ${c.maxDelta}`;
    return {
      pass,
      message: () => (pass ? `${name} matches: ${summary}` : `${name} doesn't match its golden: ${summary}, over the ${(maxDiffRatio * 100).toFixed(3)}% allowed. See ${join(dirname(path), "__failures__")}.`),
    };
  },
});
