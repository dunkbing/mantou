// <WebView> against the real core, headless: a page's frames reach the window, and clicks reach the page.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { View, WebView, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const px = (h: HeadlessCore, x: number, y: number) => {
  const c = h.capture();
  return Array.from(c.pixels.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
};

async function until(h: HeadlessCore, ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) {
    await Bun.sleep(50);
    h.step();
  }
}

test.skipIf(process.platform !== "darwin")("a page's frame is drawn where the view is", async () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <View style={{ padding: 20 }}>
      <WebView html="<body style='margin:0;background:#ff0000'>" style={{ width: 100, height: 80 }} />
    </View>
  ));
  h.step();
  await until(h, () => px(h, 60, 60)[0] === 255 && px(h, 60, 60)[1] === 0);
  expect(px(h, 60, 60)).toEqual([255, 0, 0, 255]);
  expect(px(h, 150, 150)[0]).not.toBe(255); // outside it
}, 15000);

test.skipIf(process.platform !== "darwin")("a click in the window is a click in the page", async () => {
  const h = new HeadlessCore({ width: 200, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <View style={{ padding: 20 }}>
      <WebView html="<body onclick='document.body.style.background=&quot;#0000ff&quot;' style='margin:0;background:#ff0000'>" style={{ width: 100, height: 80 }} />
    </View>
  ));
  h.step();
  await until(h, () => px(h, 60, 60)[1] === 0 && px(h, 60, 60)[0] === 255);
  h.press([60, 60]);
  await until(h, () => px(h, 60, 60)[2] === 255);
  expect(px(h, 60, 60)).toEqual([0, 0, 255, 255]);
}, 15000);
