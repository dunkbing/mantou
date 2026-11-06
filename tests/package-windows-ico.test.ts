// The Windows icon (dunkbing/mantou#82): drawn by the real core, so it runs with the headless tests.
import { expect, test } from "bun:test";
import { decodePng } from "../runtime/png";
import { DEFAULT_ICON } from "../runtime/package-linux";
import { makeIco } from "../runtime/package-windows";

test("the icon has the usual sizes: bitmaps below 64 px, PNGs above", () => {
  const ico = Buffer.from(makeIco(new TextEncoder().encode(DEFAULT_ICON)));
  expect(ico.readUInt16LE(2)).toBe(1);
  const n = ico.readUInt16LE(4);
  expect(n).toBe(7);
  const sizes: number[] = [];
  for (let k = 0; k < n; k++) {
    const at = 6 + 16 * k;
    const size = ico[at] || 256;
    sizes.push(size);
    const len = ico.readUInt32LE(at + 8);
    const data = ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + len);
    if (size >= 64) {
      const png = decodePng(data);
      expect([png.width, png.height]).toEqual([size, size]);
    } else {
      expect(data.readUInt32LE(0)).toBe(40);
      expect(data.readInt32LE(4)).toBe(size);
      expect(data.readInt32LE(8)).toBe(size * 2);
      expect(data.length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
    }
  }
  expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
});

