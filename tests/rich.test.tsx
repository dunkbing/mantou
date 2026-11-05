// Rich text on the real core, headless (dunkbing/mantou#15): <Text> spans
// inside a <Text> with their own weight, style, colour, size, decoration and
// highlight; links that press and show the pointer.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { Text, View, createSignal, mount, type JSX, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element, scale = 1) {
  const h = new HeadlessCore({ width: 360, height: 160, scale });
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

const link = { color: "#2563eb", textDecoration: "underline", cursor: "pointer" } as const;

test("a link inside text presses, bubbles to its Text, and shows the pointer", () => {
  let para!: Node, a!: Node;
  const log: string[] = [];
  const h = app(() => (
    <View style={{ padding: 10, alignItems: "start" }}>
      <Text ref={para} onPress={() => log.push("text")} style={{ fontSize: 16 }}>
        Read the <Text ref={a} style={link} onPress={() => log.push("link")}>docs</Text>
      </Text>
    </View>
  ));
  const r = h.rect(para)!;
  const y = (r[1] + r[3]) / 2;
  h.press([r[2] - 4, y]); // on "docs", the end of the line
  expect(log).toEqual(["link", "text"]); // the span, then its Text
  h.press([r[0] + 4, y]); // on "Read"
  expect(log).toEqual(["link", "text", "text"]);
  h.hover([r[2] - 4, y]);
  expect(h.cursor()).toBe("pointer");
  h.hover([r[0] + 4, y]);
  expect(h.cursor()).toBe("default");
  expect(h.rect(a)).toBeNull(); // a span has no box of its own
  expect(para.textContent).toBe("Read the docs");
});

test("a bold span widens its text; changing it relays the text out", () => {
  let plain!: Node, rich!: Node;
  const [weight, setWeight] = createSignal(400);
  const h = app(() => (
    <View style={{ alignItems: "start" }}>
      <Text ref={plain} style={{ fontSize: 16 }}>Hello world</Text>
      <Text ref={rich} style={{ fontSize: 16 }}>Hello <Text style={{ fontWeight: weight() }}>world</Text></Text>
    </View>
  ));
  const width = (n: Node) => h.rect(n)![2] - h.rect(n)![0];
  expect(width(rich)).toBe(width(plain));
  setWeight(800);
  h.step();
  expect(width(rich)).toBeGreaterThan(width(plain));
});

test("spans at 1× and 2×: weights, italics, colours, sizes, decorations and highlights", () => {
  for (const scale of [1, 2]) {
    const h = app(
      () => (
        <View style={{ flexGrow: 1, padding: 16, gap: 10, backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: 15, color: "#111827" }}>
            <Text style={{ fontWeight: 700 }}>Alice Chen</Text> sent the <Text style={{ backgroundColor: "#fde047" }}>invoice</Text> for <Text style={{ fontStyle: "italic", color: "#6b7280" }}>March</Text>
          </Text>
          <Text style={{ fontSize: 13, color: "#374151" }}>
            Total <Text style={{ fontSize: 20, fontWeight: 600, color: "#16a34a" }}>$1,240</Text>, due <Text style={{ textDecoration: "lineThrough", color: "#9ca3af" }}>Friday</Text> Monday. <Text style={link}>View it</Text>
          </Text>
        </View>
      ),
      scale,
    );
    expect(h.capture()).toMatchImage(`rich@${scale}x`);
  }
});
