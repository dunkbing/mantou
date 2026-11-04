import { expect, test } from "bun:test";
import { compareImages, decodePng, encodePng, type Image } from "./images";

function gradient(w: number, h: number): Image {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) pixels.set([x * 7, y * 11, (x * y) & 255, 255 - x], (y * w + x) * 4);
  return { width: w, height: h, pixels };
}

test("PNG round trip", () => {
  const img = gradient(37, 23);
  const back = decodePng(encodePng(img));
  expect(back.width).toBe(37);
  expect(back.height).toBe(23);
  expect(back.pixels).toEqual(img.pixels);
});

test("the comparison counts pixels over the threshold", () => {
  const a = gradient(10, 10);
  const b = { ...a, pixels: a.pixels.slice() };
  b.pixels[0] += 10; // under the threshold
  b.pixels[4 * 5 + 1] = (b.pixels[4 * 5 + 1] + 100) & 255; // over it
  const c = compareImages(a, b, 24);
  expect(c.differing).toBe(1);
  expect(c.ratio).toBe(0.01);
  expect(c.maxDelta).toBe(100);
  expect([...c.diff.pixels.subarray(20, 24)]).toEqual([255, 0, 0, 255]);
});
