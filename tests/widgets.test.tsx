// The base components on the real core, headless (dunkbing/mantou#22): each
// one's pointer and keyboard behaviour, and the gallery as reference images.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { Button, Checkbox, Dialog, Input, RadioGroup, Slider, Splitter, Tabs, Text, Toggle, Tooltip, View, createSignal, mount, type JSX, type Node } from "mantou-ui";
import { Gallery } from "../examples/gallery/Gallery";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element, size = { width: 400, height: 300 }, scale = 1) {
  const h = new HeadlessCore({ ...size, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

const at = (h: HeadlessCore, n: Node) => h.focused() === n;

test("Button: a press, Enter and Space; disabled does nothing and Tab passes it by", () => {
  let save!: Node;
  let n = 0;
  const h = app(() => (
    <View style={{ padding: 10, gap: 8, alignItems: "start" }}>
      <View ref={save}><Button onPress={() => n++}>Save</Button></View>
      <Button disabled onPress={() => n += 100}>Off</Button>
    </View>
  ));
  const button = save.elements[0];
  h.press(button);
  expect(n).toBe(1);
  h.key("Enter");
  h.key(" ");
  expect(n).toBe(3);
  h.key("Tab");
  expect(at(h, button)).toBe(true); // the only one Tab reaches: it wraps to itself
  h.press([30, 60]); // the disabled one
  expect(n).toBe(3);
});

test("Checkbox and Toggle: a press or Space toggles; the state is the app's", () => {
  let box!: Node, sw!: Node;
  const [a, setA] = createSignal(false);
  const [b, setB] = createSignal(true);
  const h = app(() => (
    <View style={{ padding: 10, gap: 8, alignItems: "start" }}>
      <View ref={box}><Checkbox checked={a()} onChange={setA}>News</Checkbox></View>
      <View ref={sw}><Toggle checked={b()} onChange={setB}>Wi-Fi</Toggle></View>
    </View>
  ));
  h.press(box.elements[0]);
  expect(a()).toBe(true);
  h.key(" ");
  expect(a()).toBe(false);
  h.key("Tab");
  h.key(" ");
  expect(b()).toBe(false);
  h.press(sw.elements[0]);
  expect(b()).toBe(true);
});

test("RadioGroup: Tab reaches the chosen option once; the arrows move the choice and the focus", () => {
  let before!: Node;
  const [v, setV] = createSignal("b");
  const h = app(() => (
    <View style={{ padding: 10, gap: 8 }}>
      <Input ref={before} style={{ width: 100, height: 24 }} />
      <RadioGroup value={v()} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C", disabled: true }, { value: "d", label: "D" }]} />
    </View>
  ));
  h.key("Tab");
  expect(h.focused()).toBe(before);
  h.key("Tab");
  const chosen = h.focused()!;
  expect(chosen.textContent || chosen.elements.map((e) => e.textContent).join("")).toContain("B");
  h.key("ArrowDown");
  expect(v()).toBe("d"); // the disabled one is passed by
  h.key("ArrowDown");
  expect(v()).toBe("a"); // and it wraps
  h.key("ArrowUp");
  expect(v()).toBe("d");
  h.key("Tab");
  expect(h.focused()).toBe(before); // one stop for the whole group
});

test("Slider: press the track, drag the thumb, and the keys", () => {
  let wrap!: Node;
  const [v, setV] = createSignal(50);
  const h = app(() => (
    <View style={{ padding: 20 }}>
      <View ref={wrap} style={{ width: 216 }}><Slider value={v()} onChange={setV} step={5} /></View>
    </View>
  ));
  const r = h.rect(wrap.elements[0])!;
  const y = (r[1] + r[3]) / 2;
  // 216 px wide with a 16 px thumb: 200 px of travel from x = 28.
  h.pointer("down", 28, y);
  expect(v()).toBe(0);
  h.pointer("move", 28 + 150, y);
  expect(v()).toBe(75);
  h.pointer("move", 1000, y); // past the end: clamped, still dragging
  expect(v()).toBe(100);
  h.pointer("up", 1000, y);
  h.key("ArrowLeft");
  expect(v()).toBe(95);
  h.key("PageDown");
  expect(v()).toBe(85);
  h.key("Home");
  expect(v()).toBe(0);
  h.key("End");
  expect(v()).toBe(100);
});

test("Tabs: a press or the arrows choose a tab, and its content shows", () => {
  let wrap!: Node;
  const [t, setT] = createSignal<"a" | "b" | "c">("a");
  const h = app(() => (
    <View ref={wrap}>
      <Tabs tabs={[{ id: "a", label: "Inbox" }, { id: "b", label: "Sent" }, { id: "c", label: "Drafts" }]} value={t()} onChange={setT}>
        {(id) => <Text>{`Panel ${id}`}</Text>}
      </Tabs>
    </View>
  ));
  const panel = () => wrap.elements[0].elements[1].textContent;
  expect(panel()).toBe("Panel a");
  h.key("Tab"); // the chosen tab
  h.key("ArrowRight");
  h.key("ArrowRight");
  expect(t()).toBe("c");
  expect(panel()).toBe("Panel c");
  h.key("ArrowRight");
  expect(t()).toBe("a"); // wraps
  h.key("Tab");
  expect(h.focused()).toBeTruthy(); // one stop for the tab list
});

test("Dialog: Tab stays inside, Escape and the backdrop close it, and the focus goes back", () => {
  let opener!: Node;
  const [open, setOpen] = createSignal(false);
  const h = app(() => (
    <View style={{ flexGrow: 1, padding: 10 }}>
      <View ref={opener}><Button onPress={() => setOpen(true)}>Open</Button></View>
      <Dialog open={open()} onClose={() => setOpen(false)} title="Sure?">
        <Button onPress={() => {}}>One</Button>
        <Button onPress={() => setOpen(false)}>Two</Button>
      </Dialog>
    </View>
  ));
  h.key("Tab");
  h.key("Enter");
  expect(open()).toBe(true);
  const inside: Node[] = [];
  for (let i = 0; i < 4; i++) {
    h.key("Tab");
    inside.push(h.focused()!);
  }
  expect(new Set(inside).size).toBe(2); // Tab goes round the dialog's two buttons
  h.key("Escape");
  expect(open()).toBe(false);
  expect(h.focused()).toBe(opener.elements[0]); // back where it was
  h.key("Enter");
  h.press([395, 295]); // the backdrop, far from the card
  expect(open()).toBe(false);
});

test("Tooltip: shows after the pointer rests, hides when it leaves", async () => {
  let anchor!: Node, wrap!: Node;
  const h = app(() => (
    <View ref={wrap} style={{ padding: 10 }}>
      <Tooltip text="Copy the link" delay={20}>
        <View ref={anchor} style={{ width: 60, height: 30 }} />
      </Tooltip>
    </View>
  ));
  const tip = () => wrap.elements[0].elements[1]?.elements[0]?.textContent;
  h.hover(anchor);
  expect(tip()).toBeUndefined();
  // The delay is a JS timer: wait until it fires (a condition, not a time).
  for (const giveUp = Date.now() + 5000; tip() === undefined && Date.now() < giveUp; ) {
    await new Promise((r) => setTimeout(r, 5));
    h.step();
  }
  expect(tip()).toBe("Copy the link");
  h.hover([300, 250]);
  expect(tip()).toBeUndefined();
});

test("Splitter: drag the handle to resize, within its limits", () => {
  const [size, setSize] = createSignal(100);
  const h = app(() => (
    <View style={{ flexGrow: 1 }}>
      <Splitter size={size()} onResize={setSize} min={50} max={250}>
        {[<View />, <View />]}
      </Splitter>
    </View>
  ));
  const y = 150;
  h.pointer("down", 103, y); // on the 6 px handle at x = 100
  h.pointer("move", 163, y);
  expect(size()).toBe(160);
  h.pointer("move", 900, y);
  expect(size()).toBe(250);
  h.pointer("up", 900, y);
  h.pointer("move", 30, y);
  expect(size()).toBe(250); // the button is up: no longer dragging
});

test("the gallery at 1× and 2×", () => {
  for (const scale of [1, 2]) {
    const h = app(() => <Gallery />, { width: 560, height: 420 }, scale);
    expect(h.capture()).toMatchImage(`gallery@${scale}x`);
  }
});
