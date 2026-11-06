// Finding nodes by testId and reading the screen as a tree, on the real core, headless.
import { afterEach, expect, test } from "bun:test";
import { Scroll, Text, View, createSignal, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { Counter } from "../examples/counter/Counter";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => ReturnType<typeof View>, width = 400, height = 300) {
  const h = new HeadlessCore({ width, height });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

test("nodes are found, pressed and read by testId", () => {
  const h = app(() => <Counter />, 480, 360);
  h.press("add").press("add").press("remove");
  expect(h.find("count")!.textContent).toBe("1");
  expect(h.rect("add")).toEqual([24, 24, 112, 68]);
  expect(() => h.press("save")).toThrow(/no node with testId "save" \(there are: "add", "remove", "reset", "count"\)/);
});

test("the tree shows what's drawn: transforms, clips, opacity, animation, text and roles", () => {
  const [x, setX] = createSignal(0);
  const h = app(() => (
    <View style={{ padding: 10, gap: 10 }}>
      <View testId="faded" role="button" label="Save" style={{ width: 50, height: 20, opacity: 0.5, translateX: 5 }} />
      <Scroll testId="list" style={{ height: 40 }}>
        <Text testId="first" style={{ height: 30 }}>One</Text>
        <Text testId="second" style={{ height: 30 }}>Two</Text>
        <Text testId="third" style={{ height: 30 }}>Three</Text>
      </Scroll>
      <View testId="mover" transition={{ translateX: { duration: 100, easing: "linear" } }} style={{ width: 10, height: 10, translateX: x() }} />
    </View>
  ));
  setX(50);
  h.step(50);
  const tree = h.tree()!;
  const byId = (id: string) => {
    const find = (n: typeof tree): typeof tree | null => (n.testId === id ? n : n.children.map(find).find(Boolean) ?? null);
    return find(tree)!;
  };
  expect(byId("faded")).toMatchObject({ kind: "View", role: "button", label: "Save", rect: [15, 10, 50, 20], opacity: 0.5 });
  expect(byId("second")).toMatchObject({ text: "Two", rect: [10, 70, 380, 30], visible: [10, 70, 380, 10] }); // cut by the scroll view
  expect(byId("third").visible).toBeNull(); // scrolled out of view
  expect(byId("mover")).toMatchObject({ rect: [35, 90, 10, 10], animating: true });
  const text = h.treeText();
  expect(text).toContain('View#');
  expect(text).toMatch(/Text#\d+ \[second\] "Two" 10,70 380×30 clipped/);
  expect(text).toMatch(/Text#\d+ \[third\] "Three" 10,100 380×30 hidden/);
  expect(text).toMatch(/\[faded\] 15,10 50×20 role=button label="Save" opacity=0.5/);
  expect(text).toMatch(/\[mover\] 35,90 10×10 animating/);
  h.step(100);
  expect(h.tree("mover")).toMatchObject({ rect: [60, 90, 10, 10] });
  expect(h.tree("mover")!.animating).toBeUndefined();
});
