// Animations on the real core, headless (dunkbing/mantou#20): transitions,
// animate(), transforms, and the clock (a headless instance's is manual:
// `step(ms)` advances it).
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { For, Show, Text, View, createSignal, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => ReturnType<typeof View>, scale = 1) {
  const h = new HeadlessCore({ width: 300, height: 200, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("a transition prop animates changes on the core's clock, with no ops per frame", () => {
  let box!: Node;
  const [open_, setOpen] = createSignal(false);
  const h = app(() => (
    <View>
      <View
        ref={box}
        transition={{ translateX: { duration: 200, easing: "linear" }, opacity: 200 }}
        style={{ width: 50, height: 50, backgroundColor: "#2563eb", translateX: open_() ? 100 : 0, opacity: open_() ? 1 : 0.5 }}
      />
    </View>
  ));
  expect(h.rect(box)).toEqual([0, 0, 50, 50]);
  setOpen(true);
  h.step();
  const commits = h.ui.commits;
  expect(h.rect(box)).toEqual([0, 0, 50, 50]); // it starts where it was
  h.step(100);
  expect(h.rect(box)).toEqual([50, 0, 100, 50]); // halfway
  h.step(100);
  expect(h.rect(box)).toEqual([100, 0, 150, 50]);
  expect(h.ui.commits).toBe(commits); // the core animated it alone
});

test("animate() runs on the core and settles when it ends", async () => {
  let box!: Node;
  const h = app(() => (
    <View>
      <View ref={box} style={{ width: 40, height: 40, backgroundColor: "#16a34a" }} />
    </View>
  ));
  let done = false;
  const a = box.animate("translateY", { from: 0, to: 60, duration: 100, easing: "linear", iterations: 2, alternate: true });
  a.finished.then(() => (done = true));
  h.step();
  h.step(50);
  expect(h.rect(box)![1]).toBe(30);
  h.step(100);
  expect(h.rect(box)![1]).toBe(30); // on its way back
  await Promise.resolve();
  expect(done).toBe(false);
  h.step(50);
  await a.finished;
  expect(h.rect(box)![1]).toBe(0); // back to its style
  expect(h.received.animationEnd).toBe(1);
});

test("stop() ends an endless animation; a released node's animations settle", async () => {
  let box!: Node;
  const [shown, setShown] = createSignal(true);
  const h = app(() => (
    <View>
      {shown() && <View ref={box} style={{ width: 40, height: 40, backgroundColor: "#dc2626" }} />}
    </View>
  ));
  const spin = box.animate("scale", { from: 1, to: 1.5, duration: 400, iterations: Infinity, alternate: true });
  h.step();
  h.step(10_400);
  expect(h.rect(box)).toEqual([0, 0, 40, 40]); // 26 cycles, there and back 13 times
  h.step(400);
  expect(h.rect(box)).toEqual([-10, -10, 50, 50]); // one more: at 1.5×
  spin.stop();
  h.step();
  await spin.finished;
  const pulse = box.animate("opacity", { from: 0, to: 1, duration: 300, iterations: Infinity });
  setShown(false);
  h.step();
  await pulse.finished;
  expect(h.ui.animations.size).toBe(0);
});

test("colours and transforms are drawn mid-animation", () => {
  let box!: Node;
  const h = app(() => (
    <View>
      <View ref={box} style={{ position: "absolute", left: 100, top: 50, width: 100, height: 100, backgroundColor: "#ff0000" }} />
    </View>
  ));
  box.animate("backgroundColor", { from: "#ff0000", to: "#0000ff", duration: 100, easing: "linear" });
  box.animate("scale", { from: 1, to: 0.5, duration: 100, easing: "linear" });
  h.step();
  h.step(50);
  // Three quarters of its size about its centre (150, 100), half red, half blue.
  expect(h.rect(box)).toEqual([112.5, 62.5, 187.5, 137.5]);
  expect(h.scene()).toContain("quad 113 63 188 138 #800080ff");
});

test("transformed views, text inside, at 1× and 2×", () => {
  for (const scale of [1, 2]) {
    const h = app(
      () => (
        <View style={{ flexGrow: 1, backgroundColor: "#f8fafc", padding: 30, flexDirection: "row", gap: 30 }}>
          <View style={{ width: 90, height: 60, borderRadius: 10, backgroundColor: "#2563eb", justifyContent: "center", scale: 1.5, translateY: 30 }}>
            <Text style={{ color: "#ffffff", textAlign: "center", fontSize: 14 }}>Scaled</Text>
          </View>
          <View style={{ width: 90, height: 60, borderRadius: 10, borderWidth: 2, borderColor: "#16a34a", backgroundColor: "#ffffff", justifyContent: "center", translateX: 40, scale: 0.75, boxShadow: { y: 4, blur: 8, color: "#0004" } }}>
            <Text style={{ color: "#14532d", textAlign: "center", fontSize: 14 }}>Moved</Text>
          </View>
        </View>
      ),
      scale,
    );
    expect(h.capture()).toMatchImage(`transform@${scale}x`);
  }
});

test("animate with keyframes passes through each value, evenly spaced", () => {
  let box!: Node;
  const h = app(() => <View><View ref={box} style={{ width: 50, height: 50 }} /></View>);
  box.animate("translateX", { keyframes: [0, 100, 40], duration: 200, easing: "linear" });
  h.step();
  h.step(50);
  expect(h.rect(box)![0]).toBe(50); // halfway to the first step
  h.step(50);
  expect(h.rect(box)![0]).toBe(100);
  h.step(50);
  expect(h.rect(box)![0]).toBe(70);
  h.step(60);
  expect(h.rect(box)![0]).toBe(0); // done: back to the style
});

test("a spring overshoots when under-damped and settles at the target; the duration comes from it", () => {
  let box!: Node;
  const [open_, setOpen] = createSignal(false);
  const h = app(() => (
    <View>
      <View ref={box} transition={{ translateX: { spring: { stiffness: 300, damping: 12 } } }} style={{ width: 50, height: 50, translateX: open_() ? 100 : 0 }} />
    </View>
  ));
  setOpen(true);
  h.step();
  let max = 0;
  for (let i = 0; i < 100; i++) {
    h.step(16);
    max = Math.max(max, h.rect(box)![0]);
  }
  expect(max).toBeGreaterThan(105); // overshoots
  expect(h.rect(box)![0]).toBe(100); // settled
  expect(h.ui.commits).toBeGreaterThan(0);
});

test("a critically damped spring never overshoots", () => {
  let box!: Node;
  const h = app(() => <View><View ref={box} style={{ width: 50, height: 50 }} /></View>);
  box.animate("translateX", { from: 0, to: 100, spring: { stiffness: 200, damping: 2 * Math.sqrt(200) } });
  h.step();
  let max = 0;
  for (let i = 0; i < 100; i++) {
    h.step(16);
    max = Math.max(max, h.rect(box)![0]);
  }
  expect(max).toBeLessThanOrEqual(100);
});

test("transition: { layout } slides a node to where layout puts it when its siblings change", () => {
  const colors = { a: "#ff0000", b: "#00ff00", c: "#0000ff" } as const;
  const [rows, setRows] = createSignal<("a" | "b" | "c")[]>(["a", "b", "c"]);
  const h = new HeadlessCore({ width: 100, height: 100 });
  open.push(h);
  mount(h.ui, () => (
    <View>
      <For each={rows()}>{(r) => <View transition={{ layout: 200 }} style={{ height: 30, backgroundColor: colors[r] }} />}</For>
    </View>
  ));
  h.step();
  const yOf = (hex: string) => Number((h.scene().split("\n").find((l) => l.includes(hex)) ?? "").split(" ")[2]);
  expect(yOf("#00ff00")).toBe(30);
  setRows(["b", "c"]); // the red one goes
  h.step(0);
  expect(yOf("#00ff00")).toBeCloseTo(30, 0); // drawn where it was: nothing jumps
  h.step(100);
  const mid = yOf("#00ff00");
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(30);
  h.step(150);
  expect(yOf("#00ff00")).toBe(0);
  expect(yOf("#0000ff")).toBe(30);
});

test("a layout transition doesn't animate a node's first placement", () => {
  const [on, setOn] = createSignal(false);
  const h = new HeadlessCore({ width: 100, height: 100 });
  open.push(h);
  mount(h.ui, () => (
    <View>
      <Show when={on()}>
        <View transition={{ layout: 200 }} style={{ height: 30, backgroundColor: "#ff0000" }} />
      </Show>
      <View style={{ height: 30, backgroundColor: "#00ff00" }} />
    </View>
  ));
  h.step();
  setOn(true);
  h.step(0);
  const y = (hex: string) => Number((h.scene().split("\n").find((l) => l.includes(hex)) ?? "").split(" ")[2]);
  expect(y("#ff0000")).toBe(0); // a new node appears in place
  expect(y("#00ff00")).toBe(30); // the green one (no transition of its own) jumps
});
