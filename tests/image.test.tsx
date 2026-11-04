// <Image> on the real core, headless (dunkbing/mantou#13): sources, sizes,
// objectFit, tinting, rounded corners, load and error events.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { Image, View, mount, type Node } from "mantou-ui";
import { encodePng } from "mantou-ui/images";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));
const asset = (name: string) => join(import.meta.dir, "assets", name);

/** A 40 × 20 PNG: a horizontal gradient, red to blue, with a white band. */
function photo(): Uint8Array {
  const w = 40, h = 20, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const band = y >= 8 && y < 12;
      px.set(band ? [255, 255, 255, 255] : [255 - x * 6, 40, x * 6, 255], (y * w + x) * 4);
    }
  return encodePng({ width: w, height: h, pixels: px });
}

function app(width: number, height: number, scale: number, ui: () => ReturnType<typeof View>) {
  const h = new HeadlessCore({ width, height, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("images take their natural size, or keep their aspect ratio with one side set", () => {
  let natural!: Node, wide!: Node, svg!: Node;
  const loads: string[] = [];
  const bytes = photo();
  const h = app(300, 200, 1, () => (
    <View style={{ alignItems: "start" }}>
      <Image ref={natural} src={bytes} onLoad={(s) => loads.push(`${s.width}x${s.height}`)} />
      <Image ref={wide} src={bytes} style={{ width: 100 }} />
      <Image ref={svg} src={asset("archive.svg")} style={{ height: 48 }} onLoad={(s) => loads.push(`${s.width}x${s.height}`)} />
    </View>
  ));
  expect(h.rect(natural)).toEqual([0, 0, 40, 20]);
  expect(h.rect(wide)).toEqual([0, 20, 100, 70]);
  expect(h.rect(svg)).toEqual([0, 70, 48, 118]);
  expect(loads).toEqual(["40x20", "24x24"]);
  expect(h.scene()).toContain("image 0 0 40 20 40x20");
});

test("a missing file or bad bytes is an error event, not a crash", () => {
  const errors: string[] = [];
  const h = app(200, 100, 1, () => (
    <View>
      <Image src={asset("nope.png")} style={{ width: 20, height: 20 }} onError={(m) => errors.push(m)} />
      <Image src={new TextEncoder().encode("not an image")} style={{ width: 20, height: 20 }} onError={(m) => errors.push(m)} />
    </View>
  ));
  expect(errors.length).toBe(2);
  expect(errors[0]).toContain("nope.png");
  expect(h.stats().opErrors).toBe(0);
  expect(h.scene()).not.toContain("image ");
});

for (const scale of [1, 2]) {
  test(`fill, contain, cover, a rounded avatar and tinted icons at scale ${scale}`, () => {
    const bytes = photo();
    const box = { width: 64, height: 64, backgroundColor: "#e2e8f0" } as const;
    const h = app(340, 150, scale, () => (
      <View style={{ flexGrow: 1, padding: 12, gap: 12, backgroundColor: "#ffffff" }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Image src={bytes} style={{ ...box, objectFit: "fill" }} />
          <Image src={bytes} style={{ ...box, objectFit: "contain" }} />
          <Image src={bytes} style={{ ...box, objectFit: "cover" }} />
          <Image src={bytes} style={{ ...box, objectFit: "cover", borderRadius: 32 }} />
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Image src={asset("archive.svg")} style={{ width: 24, height: 24 }} />
          <Image src={asset("archive.svg")} style={{ width: 24, height: 24, color: "#2563eb" }} />
          <Image src={asset("send.svg")} style={{ width: 24, height: 24, color: "#dc2626" }} />
          <Image src={asset("send.svg")} style={{ width: 48, height: 48, color: "#16a34a", opacity: 0.5 }} />
        </View>
      </View>
    ));
    expect(h.capture()).toMatchImage(`image@${scale}x`);
  });
}
