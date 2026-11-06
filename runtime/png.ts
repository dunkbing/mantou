// PNG encoding and decoding, and rendering an image file at a size (for icons): no test framework needed.
import { deflateSync, inflateSync } from "node:zlib";
import { openCore } from "./ffi";

/** An RGBA8 image, top row first (what `HeadlessCore.capture()` returns has these fields). */
export interface Image {
  width: number;
  height: number;
  pixels: Uint8Array;
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

/**
 * Renders image bytes (PNG, JPEG, WebP or SVG) at exactly `width` × `height` px with a transparent background:
 * an SVG is drawn at that size, a raster image scaled. For icons (`encodePng(renderImage(svg, 256, 256))`).
 */
export function renderImage(bytes: Uint8Array, width: number, height: number): Image {
  const pixels = new Uint8Array(width * height * 4);
  const r = openCore().symbols.mt_render_image(bytes, bytes.byteLength, width, height, pixels, pixels.byteLength);
  if (r !== 0) throw new Error(r === -1 ? "mantou: renderImage: not an image (PNG, JPEG, WebP or SVG)" : `mantou: renderImage failed (${r})`);
  return { width, height, pixels };
}
