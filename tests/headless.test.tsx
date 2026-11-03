// The real native core, headless: tree, layout, hit-testing, press dispatch and
// the renderer, with no window, driven by the Solid counter. Needs
// `bun run build:core` and, for captures, a GPU adapter (Mesa's lavapipe on Linux).
import { afterEach, expect, test } from "bun:test";
import { mount, View, createSignal, Show } from "mantou-ui";
import { Counter } from "../examples/counter/Counter";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
function counter(options = { width: 520, height: 320, scale: 1 }) {
  const h = new HeadlessCore(options);
  open.push(h);
  mount(h.ui, () => <Counter />);
  h.step();
  return h;
}
afterEach(() => open.splice(0).forEach((h) => h.free()));

// Where the counter's parts are laid out (logical px).
const PLUS: [number, number] = [68, 46];
const MINUS: [number, number] = [168, 46];
const RESET: [number, number] = [268, 46];
const BOARD: [number, number] = [300, 200];

test("the counter lays out as designed", () => {
  const h = counter();
  // The point hits each button's label; the button is its parent.
  const plus = h.hit(...PLUS)!, minus = h.hit(...MINUS)!;
  expect(plus.isText && plus.textContent).toBe("+1");
  expect(h.rect(plus.parent!)).toEqual([24, 24, 112, 68]);
  expect(h.rect(minus.parent!)).toEqual([124, 24, 212, 68]);
  expect(h.rect(h.hit(...BOARD)!)).toEqual([24, 84, 496, 296]);
  expect(h.stats()).toMatchObject({ commits: 1, opErrors: 0, quads: 5, nodes: 11 });
  expect(h.stats().glyphs).toBe(2 + 2 + 5 + 1); // "+1", "−1", "Reset", "0"
});

test("a press is hit-tested by the core, reaches the handler, and its commit is drawn", () => {
  const h = counter();
  h.press(PLUS);
  const s = h.stats();
  expect(s).toMatchObject({ presses: 1, commits: 2, quads: 6, opErrors: 0 });
  const board = h.hit(...BOARD)!;
  // Squares are 28 px, inside the board's 12 px padding.
  expect(h.rect(board.elements[0])).toEqual([36, 96, 64, 124]);
  h.press(PLUS);
  expect(h.ui.lastCommitOps).toBe(5); // CREATE, STYLE_USE, INSERT, TEXT, TITLE
});

test("a press away from any listener does nothing; a drag off the button is not a press", () => {
  const h = counter();
  h.press(BOARD);
  h.pointer("down", ...PLUS).pointer("move", ...BOARD).pointer("up", ...BOARD);
  expect(h.stats()).toMatchObject({ presses: 0, quads: 5 });
});

test("the squares wrap onto new rows; − and ⟲ release them", () => {
  const h = counter();
  for (let i = 0; i < 14; i++) h.press(PLUS);
  const board = h.hit(...BOARD)!;
  expect(board.elements.length).toBe(14);
  expect(h.rect(board.elements[11])![1]).toBe(96);
  expect(h.rect(board.elements[12])).toEqual([36, 132, 64, 160]);
  h.press(MINUS);
  expect(board.elements.length).toBe(13);
  h.press(RESET);
  expect(h.stats()).toMatchObject({ nodes: 11, quads: 5 });
});

test("resizing relayouts without the app; layout is in device pixels at the scale", () => {
  const h = counter({ width: 520, height: 320, scale: 2 });
  expect(h.scene()).toContain("quad 48 48 224 136 #16a34aff"); // + at 2×
  const commits = h.stats().commits;
  h.resize(300, 200);
  expect(h.rect(h.hit(150, 150)!)).toEqual([24, 84, 276, 176]);
  expect(h.stats().commits).toBe(commits);
  expect(h.received.resized).toBe(1);
});

test("conditional children come and go with their nodes", () => {
  const h = new HeadlessCore({ width: 200, height: 100 });
  open.push(h);
  const [on, setOn] = createSignal(false);
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, padding: 10, backgroundColor: "#202020" }}>
      <Show when={on()}>
        <View style={{ height: 20, backgroundColor: "#ff000080" }} />
      </Show>
    </View>
  ));
  h.ui.clearColor(0, 0, 0, 1);
  expect(h.scene()).toBe(["size 200x100", "clear #000000ff", "quad 0 0 200 100 #202020ff", ""].join("\n"));
  setOn(true);
  expect(h.scene()).toBe(["size 200x100", "clear #000000ff", "quad 0 0 200 100 #202020ff", "quad 10 10 190 30 #ff000080", ""].join("\n"));
  setOn(false);
  expect(h.step().stats()).toMatchObject({ nodes: 2, quads: 1 });
});

test("the count is drawn as text, right-aligned, and follows presses and keys", () => {
  const h = counter();
  const count = h.hit(480, 46)!;
  expect(count.textContent).toBe("0");
  h.press(PLUS).press(PLUS).key("ArrowUp");
  expect(count.textContent).toBe("3");
  h.key("-");
  expect(count.textContent).toBe("2");
  const shot = h.capture();
  // The digit is near the right edge (textAlign: "end"), light on the dark background.
  let lit = 0;
  for (let x = 440; x < 496; x++) for (let y = 30; y < 62; y++) if (shot.at(x, y)[0] > 200) lit++;
  expect(lit).toBeGreaterThan(40);
}, 30_000);

test("captured pixels show what the scene says", () => {
  const h = counter();
  h.press(PLUS);
  const shot = h.capture();
  expect([shot.width, shot.height]).toEqual([520, 320]);
  expect(shot.at(5, 5)).toEqual([0x11, 0x13, 0x18, 255]); // background
  expect(shot.at(30, 30)).toEqual([0x16, 0xa3, 0x4a, 255]); // + (away from its label)
  expect(shot.at(130, 30)).toEqual([0xdc, 0x26, 0x26, 255]); // −
  expect(shot.at(50, 110)).toEqual([0xf5, 0x9e, 0x0b, 255]); // the first square
  expect(shot.at(300, 200)).toEqual([0x1f, 0x24, 0x30, 255]); // the board
}, 30_000); // the first capture opens a GPU device and compiles its shaders

test("instances are independent", () => {
  const a = counter(), b = counter();
  a.press(PLUS).press(PLUS);
  b.press(PLUS);
  expect([a.stats().nodes, b.stats().nodes]).toEqual([13, 12]);
});
