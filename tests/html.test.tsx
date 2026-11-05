// Html nodes (dunkbing/mantou#74) on the real core, headless: a static HTML/CSS document laid out and drawn
// by the core, with its height following the document, images from the app, links that never navigate,
// and bands drawn only where it shows.
import { encodePng } from "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { Html, Scroll, View, createSignal, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => ReturnType<typeof View>, size = { width: 480, height: 320 }) {
  const h = new HeadlessCore(size);
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

/** A solid-colour PNG. */
function png(width: number, height: number, rgba: [number, number, number, number]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return encodePng({ width, height, pixels });
}

const MAIL = `<body style="margin:0;background:#ffffff;font-family:Inter">
  <table width="300" cellpadding="0" cellspacing="0"><tr><td style="background:#1f883d;height:40px">
    <a href="https://example.com/go" style="display:block;height:40px;color:#ffffff">Go</a>
  </td></tr></table>
  <img src="cid:logo@mail" style="display:block">
  <div style="height:60px;background:#ff0000"></div>
</body>`;

test("the document is drawn where the node is, and its height is the document's", () => {
  let html!: Node;
  const h = app(() => (
    <View style={{ padding: 20, flexGrow: 1, backgroundColor: "#808080" }}>
      <Html ref={html} html={MAIL} style={{ width: 400 }} />
    </View>
  ));
  const [x0, y0, x1, y1] = h.rect(html)!;
  expect([x0, y0, x1]).toEqual([20, 20, 420]);
  const c = h.capture();
  expect(c.at(30, 30)).toEqual([0x1f, 0x88, 0x3d, 255]); // the green cell
  expect(c.at(350, 30)).toEqual([255, 255, 255, 255]); // beside the 300 px table
  // The red block is the document's last 60 px, and the node ends where it does.
  expect(c.at(30, y1 - 2)).toEqual([255, 0, 0, 255]);
  expect(c.at(30, y1 - 58)).toEqual([255, 0, 0, 255]);
  expect(c.at(30, y1 + 2)).toEqual([128, 128, 128, 255]); // below the node: its parent
});

test("images come from loadImage, once per URL; the height follows them", async () => {
  const asked: string[] = [];
  let html!: Node;
  const h = app(() => (
    <Html
      ref={html}
      html={MAIL}
      loadImage={async (url) => {
        asked.push(url);
        return png(50, 30, [0, 0, 255, 255]);
      }}
      style={{ width: 400 }}
    />
  ));
  const height = () => h.rect(html)![3] - h.rect(html)![1];
  const before = height();
  for (let i = 0; i < 100 && height() === before; i++) {
    await Bun.sleep(1);
    h.step();
  }
  expect(asked).toEqual(["cid:logo@mail"]);
  expect(height()).toBe(before + 30); // the 50 × 30 image
  const top = h.rect(html)![1];
  expect(h.capture().at(10, top + before - 60 + 15)).toEqual([0, 0, 255, 255]); // between the cell and the red block
});

test("without a loadImage nothing is loaded, and a data: URL needs none", () => {
  const dot = Buffer.from(png(10, 10, [255, 0, 255, 255])).toString("base64");
  let html!: Node;
  const h = app(() => <Html ref={html} html={`<body style="margin:0"><img src="https://tracker.example/p.gif" style="display:block"><img src="data:image/png;base64,${dot}" style="display:block"></body>`} style={{ width: 200 }} />);
  expect(h.rect(html)![3] - h.rect(html)![1]).toBe(10); // only the data: image
  expect(h.capture().at(5, 5)).toEqual([255, 0, 255, 255]);
});

test("a pressed link goes to onLink, and the pointer over it shows the hand", () => {
  const links: string[] = [];
  const h = app(() => (
    <View style={{ padding: 20 }}>
      <Html html={MAIL} onLink={(url) => links.push(url)} style={{ width: 400 }} />
    </View>
  ));
  h.press([40, 40]);
  h.press([40, 100]); // the red block: no link
  expect(links).toEqual(["https://example.com/go"]);
  h.hover([40, 40]);
  expect(h.cursor()).toBe("pointer");
  h.hover([40, 100]);
  expect(h.cursor()).toBe("default");
});

test("in a scroll view it scrolls and clips like any node, drawn a band at a time", () => {
  const rows = Array.from({ length: 60 }, (_, i) => `<div style="height:50px;background:${i % 2 ? "#ff0000" : "#0000ff"}">${i}</div>`).join("");
  let scroll!: Node;
  const h = app(
    () => (
      <View style={{ flexGrow: 1, backgroundColor: "#808080" }}>
        <Scroll ref={scroll} style={{ height: 200 }}>
          <Html html={`<body style="margin:0">${rows}</body>`} style={{ width: 300 }} />
        </Scroll>
      </View>
    ),
    { width: 300, height: 300 },
  );
  // 3000 px of document, 200 showing: one 512 px band.
  expect(h.scene().match(/^image /gm)?.length).toBe(1);
  let c = h.capture();
  expect(c.at(10, 10)).toEqual([0, 0, 255, 255]); // row 0
  expect(c.at(10, 60)).toEqual([255, 0, 0, 255]); // row 1
  expect(c.at(10, 250)).toEqual([128, 128, 128, 255]); // below the scroll view: clipped
  scroll.scrollTo({ y: 1000 });
  h.step();
  c = h.capture();
  expect(c.at(10, 10)).toEqual([0, 0, 255, 255]); // row 20
  expect(c.at(10, 60)).toEqual([255, 0, 0, 255]); // row 21
  expect(h.scene().match(/^image /gm)?.length).toBe(2); // 1000 to 1200 spans bands 1 and 2
});

test("colorScheme answers prefers-color-scheme, and changing it redraws", () => {
  const [scheme, setScheme] = createSignal<"light" | "dark">("light");
  const doc = `<style>body{margin:0;background:#ffffff} @media (prefers-color-scheme: dark){body{background:#000000}}</style><div style="height:20px"></div>`;
  const h = app(() => <Html html={doc} colorScheme={scheme()} style={{ width: 100 }} />);
  expect(h.capture().at(5, 5)).toEqual([255, 255, 255, 255]);
  setScheme("dark");
  expect(h.capture().at(5, 5)).toEqual([0, 0, 0, 255]);
});
