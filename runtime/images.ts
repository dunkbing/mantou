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

export { encodePng, decodePng, renderImage, type Image } from "./png";
import { decodePng, encodePng, type Image } from "./png";

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
