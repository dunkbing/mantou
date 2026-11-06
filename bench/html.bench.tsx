// An HTML mail in <Html> inside a scroll view: parsing and laying it out, painting the bands that show,
// scrolling through it (new bands are painted on the CPU), and selecting text (the bands are painted again).
import { Html, Scroll, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { MESSAGE } from "../examples/mail/message";
import { report, summary, time } from "./lib";

// The sample mail, its middle part four times, so it's long enough to scroll.
const body = MESSAGE.slice(MESSAGE.indexOf("<body"), MESSAGE.indexOf("</body>"));
const long = MESSAGE.replace(body, body + body.replace("<body", "<div").replace(/^[^>]*>/, "<div>").repeat(3));
const h = new HeadlessCore({ width: 600, height: 700 });
const t = performance.now();
mount(h.ui, () => (
  <Scroll style={{ flexGrow: 1 }}>
    <Html html={long} style={{ width: "100%" }} />
  </Scroll>
));
h.step();
const first = performance.now() - t;
// Bands are kept once painted: most scroll steps reuse them, and a step that reaches a new band paints it.
const steps = time(() => h.wheel(300, 350, 100), 12, 0);
const scrolls = summary(steps);
h.wheel(300, 350, -100000);
// A selection starts on text: find some (the text cursor shows there), then drag down from it.
let from: [number, number] | null = null;
for (let y = 120; y < 600 && !from; y += 4) for (let x = 60; x < 500 && !from; x += 8) if (h.hover([x, y]).cursor() === "text") from = [x, y];
if (!from) throw new Error("no text found to select");
const [x0, y0] = from;
h.pointer("down", x0, y0);
const select = summary(time((i) => h.pointer("move", x0 + 40 + (i % 5) * 20, y0 + 20 + i * 8), 30, 2));
h.pointer("up", x0, y0 + 300);
report({
  "first frame (parse, layout, paint) ms": first,
  "scroll 100 px median ms": scrolls.median,
  "scroll 100 px reaching a new band (max) ms": Math.max(...steps),
  "selection drag step median ms": select.median,
  "selection drag step p95 ms": select.p95,
});
h.free();
