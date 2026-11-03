// <Input> on the real core, headless: focus, typing, controlled values,
// submit, shortcuts and the clipboard, the IME, and which keys reach the app.
import { afterEach, expect, test } from "bun:test";
import { Input, View, createSignal, mount, onKey, type JSX, type Node } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element) {
  const h = new HeadlessCore({ width: 400, height: 300 });
  open.push(h);
  mount(h.ui, ui);
  h.step();
  return h;
}

const field = { width: 240, height: 32, paddingLeft: 8, fontSize: 14 } as const;

test("pressing an input focuses it; typing changes it with no ops from the app", () => {
  let input!: Node;
  const changes: string[] = [];
  const focus: string[] = [];
  const h = app(() => (
    <View style={{ padding: 20, gap: 10 }}>
      <Input ref={input} style={field} placeholder="Name" onChange={(v) => changes.push(v)} onFocus={() => focus.push("focus")} onBlur={() => focus.push("blur")} />
      <View style={{ height: 40 }} onPress={() => {}} />
    </View>
  ));
  expect(h.stats().glyphs).toBe(4); // the placeholder
  h.press(input);
  expect(h.focused()).toBe(input);
  expect(input.focused).toBe(true);
  const commits = h.ui.commits;
  h.type("Ada");
  expect(h.value(input)).toBe("Ada");
  expect(input.value).toBe("Ada");
  expect(changes).toEqual(["A", "Ad", "Ada"]);
  expect(h.ui.commits).toBe(commits); // uncontrolled: the core owns the text
  expect(h.stats().glyphs).toBe(3);
  h.press([200, 75]); // the view below: blurs
  expect(h.focused()).toBeNull();
  expect(focus).toEqual(["focus", "blur"]);
});

test("a controlled input follows its signal: echoes send nothing, transforms one VALUE", () => {
  let input!: Node;
  const [text, setText] = createSignal("");
  const h = app(() => <Input ref={input} style={field} value={text()} onChange={(v) => setText(v.toUpperCase())} autoFocus />);
  expect(h.focused()).toBe(input);
  h.type("ab");
  expect(text()).toBe("AB");
  expect(h.value(input)).toBe("AB");
  expect(h.ui.lastCommitOps).toBe(1); // VALUE
  const commits = h.ui.commits;
  setText("AB");
  h.step();
  expect(h.ui.commits).toBe(commits); // the same value: nothing to send
  setText("hello");
  h.step();
  expect(h.value(input)).toBe("hello");
});

test("a controlled input that ignores changes goes back to its value", () => {
  let input!: Node;
  const h = app(() => <Input ref={input} style={field} value="fixed" onChange={() => {}} autoFocus />);
  h.type("x");
  expect(h.value(input)).toBe("fixed");
});

test("Enter submits; the app clears the field", () => {
  let input!: Node;
  const sent: string[] = [];
  const [draft, setDraft] = createSignal("");
  const h = app(() => (
    <Input ref={input} style={field} value={draft()} onChange={setDraft} onSubmit={(v) => (sent.push(v), setDraft(""))} autoFocus />
  ));
  h.type("first\n");
  h.type("second\n");
  expect(sent).toEqual(["first", "second"]);
  expect(h.value(input)).toBe("");
});

test("keys the input uses don't reach onKey; Escape and unknown shortcuts do", () => {
  let input!: Node;
  const keys: string[] = [];
  const h = app(() => {
    onKey((e) => e.type === "keyDown" && keys.push(e.key));
    return <Input ref={input} style={field} autoFocus />;
  });
  h.type("jk").key("ArrowLeft").key("Backspace").key("a", { primary: true });
  expect(keys).toEqual([]);
  h.key("Escape").key("k", { primary: true });
  expect(keys).toEqual(["Escape", "k"]);
  input.blur();
  h.step();
  h.type("j");
  expect(keys).toEqual(["Escape", "k", "j"]); // nothing focused: keys are the app's
});

test("copy, cut, paste and undo through the instance's clipboard", () => {
  let input!: Node;
  const h = app(() => <Input ref={input} style={field} defaultValue="hello" autoFocus />);
  h.key("a", { primary: true }).key("c", { primary: true });
  expect(h.clipboard).toBe("hello");
  h.key("End").key("v", { primary: true });
  expect(h.value(input)).toBe("hellohello");
  h.key("z", { primary: true });
  expect(h.value(input)).toBe("hello");
  h.clipboard = " world";
  h.key("v", { primary: true });
  expect(h.value(input)).toBe("hello world");
  h.key("a", { primary: true }).key("x", { primary: true });
  expect(h.value(input)).toBe("");
  expect(h.clipboard).toBe("hello world");
});

test("Tab moves the focus between inputs, Shift+Tab back", () => {
  let a!: Node, b!: Node;
  const h = app(() => (
    <View style={{ gap: 8 }}>
      <Input ref={a} style={field} autoFocus />
      <Input ref={b} style={field} defaultValue="selected" />
    </View>
  ));
  expect(h.focused()).toBe(a);
  h.key("Tab");
  expect(h.focused()).toBe(b);
  h.type("new"); // Tab selected all of it
  expect(h.value(b)).toBe("new");
  h.key("Tab", { shift: true });
  expect(h.focused()).toBe(a);
});

test("multiline inputs take Enter and grow; maxLength and readOnly hold", () => {
  let notes!: Node, code!: Node, fixed!: Node;
  const h = app(() => (
    <View style={{ gap: 8, alignItems: "start" }}>
      <Input ref={notes} style={{ width: 200 }} multiline autoFocus />
      <Input ref={code} style={field} maxLength={4} />
      <Input ref={fixed} style={field} defaultValue="read me" readOnly />
    </View>
  ));
  const one = h.rect(notes)!;
  h.type("one\ntwo\nthree");
  expect(h.value(notes)).toBe("one\ntwo\nthree");
  const three = h.rect(notes)!;
  expect(three[3] - three[1]).toBeGreaterThan(2.5 * (one[3] - one[1]));
  code.focus();
  h.step().type("123456");
  expect(h.value(code)).toBe("1234");
  h.press(fixed).type("x").key("Backspace");
  expect(h.value(fixed)).toBe("read me");
});

test("an IME composition shows in place and commits as one change", () => {
  let input!: Node;
  const changes: string[] = [];
  const h = app(() => <Input ref={input} style={field} onChange={(v) => changes.push(v)} autoFocus />);
  h.compose("にほん", [9, 9]);
  expect(h.value(input)).toBe("");
  expect(h.stats().glyphs).toBe(3); // drawn while composing
  h.key("Backspace"); // the IME's, not the input's
  h.compose("").insertText("日本");
  expect(h.value(input)).toBe("日本");
  expect(changes).toEqual(["日本"]);
});

test("a change larger than the event buffer arrives whole", () => {
  let input!: Node;
  let got = "";
  const h = app(() => <Input ref={input} style={field} multiline onChange={(v) => (got = v)} autoFocus />);
  const big = "0123456789abcdef".repeat(8 * 1024); // 128 KiB, twice the buffer
  h.insertText(big);
  expect(got.length).toBe(big.length);
  expect(got).toBe(big);
});

test("autoFocus focuses only when the input is created (#4)", () => {
  const [later, setLater] = createSignal(false);
  let a!: Node, b!: Node;
  const h = app(() => (
    <View>
      <Input ref={a} autoFocus />
      <Input ref={b} autoFocus={later()} />
    </View>
  ));
  expect(h.focused()?.id).toBe(a.id);
  setLater(true);
  h.step();
  expect(h.focused()?.id).toBe(a.id);
  void b;
});
