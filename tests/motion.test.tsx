// Motion settings on the real core, headless: instant changes, reduced motion, a slower clock.
import { afterEach, expect, test } from "bun:test";
import { View, createSignal, instant, mount, setAnimationSpeed, setReducedMotion, useReducedMotion, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => {
  open.splice(0).forEach((h) => h.free());
  setReducedMotion("system");
  setAnimationSpeed(1);
});

function sliding() {
  let box!: Node;
  const [x, setX] = createSignal(0);
  const h = new HeadlessCore({ width: 300, height: 200 });
  open.push(h);
  mount(h.ui, () => (
    <View>
      <View
        ref={box}
        transition={{ translateX: { duration: 200, easing: "linear" }, opacity: { duration: 200, easing: "linear" } }}
        style={{ width: 50, height: 50, backgroundColor: "#2563eb", translateX: x(), opacity: x() > 0 ? 0.5 : 1 }}
      />
    </View>
  ));
  h.step();
  return { h, box: () => h.rect(box)!, setX };
}

test("instant() applies its changes with no transition", () => {
  const { h, box, setX } = sliding();
  setX(100);
  h.step(100);
  expect(box()[0]).toBe(50); // animating
  instant(() => setX(20));
  h.step();
  expect(box()[0]).toBe(20); // there at once, the running transition ended
  setX(60);
  h.step(100);
  expect(box()[0]).toBe(40); // later changes animate again
});

test("reduced motion makes movement jump and keeps fades", () => {
  const { h, box, setX } = sliding();
  const reduced = useReducedMotion();
  setReducedMotion(true);
  expect(reduced()).toBe(true);
  setX(100);
  h.step();
  expect(box()[0]).toBe(100);
  h.step(100);
  // Halfway through the fade to 0.5 over the dark window: the blue between full (235) and the end (173).
  const blue = h.capture().at(125, 25)[2];
  expect(blue).toBeGreaterThan(190);
  expect(blue).toBeLessThan(225);
}, 60_000); // the first capture on a software GPU compiles its shaders

test("setAnimationSpeed slows the animation clock", () => {
  const { h, box, setX } = sliding();
  setAnimationSpeed(0.5);
  setX(100);
  h.step();
  h.step(200);
  expect(box()[0]).toBe(50); // 200 ms at half speed: halfway
});
