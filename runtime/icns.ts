// An .icns (macOS app icon) from an SVG or a large PNG: PNG-compressed entries, 16 to 1024 px with @2x (#85).
import { encodePng, renderImage } from "./png";

// [type, pixel size]: icp4/icp5 are 16 and 32; ic11-ic14 are the @2x of 16, 32, 128, 256.
const ENTRIES: [string, number][] = [
  ["icp4", 16], ["icp5", 32], ["ic11", 32], ["ic12", 64], ["ic07", 128],
  ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024],
];

export function makeIcns(icon: Uint8Array): Uint8Array {
  const png = new Map<number, Uint8Array>();
  for (const [, s] of ENTRIES) if (!png.has(s)) png.set(s, encodePng(renderImage(icon, s, s)));
  const parts: Uint8Array[] = [];
  let total = 8;
  for (const [type, s] of ENTRIES) {
    const data = png.get(s)!;
    const head = new Uint8Array(8);
    head.set(new TextEncoder().encode(type));
    new DataView(head.buffer).setUint32(4, data.length + 8);
    parts.push(head, data);
    total += data.length + 8;
  }
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode("icns"));
  new DataView(out.buffer).setUint32(4, total);
  let at = 8;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}
