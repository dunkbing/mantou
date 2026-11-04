// <Input> on the real core, headless: focus, typing, controlled values,
// submit, shortcuts and the clipboard, the IME, and which keys reach the app.
import { afterEach, expect, test } from "bun:test";
import { Input, Show, View, createSignal, mount, onKey, type JSX, type Node } from "mantou-ui";
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

test("a secure input shows bullets, refuses copy and cut, and still pastes (#7)", () => {
  let pw!: Node;
  const [shown, setShown] = createSignal(false);
  const values: string[] = [];
  const h = app(() => <Input ref={pw} style={field} secure={!shown()} onChange={(v) => values.push(v)} autoFocus />);
  h.type("s3cret");
  expect(h.value(pw)).toBe("s3cret");
  expect(values.at(-1)).toBe("s3cret"); // the app gets the real text
  expect(h.stats().glyphs).toBe(6); // a bullet each
  h.clipboard = "before";
  h.key("a", { primary: true }).key("c", { primary: true }).key("x", { primary: true });
  expect(h.clipboard).toBe("before"); // nothing copied
  expect(h.value(pw)).toBe("s3cret"); // nothing cut
  h.key("End").key("ArrowLeft").key("Backspace"); // the "e" before the "t"
  expect(h.value(pw)).toBe("s3crt");
  h.clipboard = "!x";
  h.key("End").key("v", { primary: true });
  expect(h.value(pw)).toBe("s3crt!x");
  setShown(true); // "show password"
  h.step();
  expect(h.value(pw)).toBe("s3crt!x");
  h.key("a", { primary: true }).key("c", { primary: true });
  expect(h.clipboard).toBe("s3crt!x");
});

test("a dialog's focus scope keeps Tab inside, then gives the focus back (#6)", () => {
  let search!: Node, to!: Node, subject!: Node, body!: Node;
  const [open, setOpen] = createSignal(false);
  const h = app(() => (
    <View style={{ flexGrow: 1 }}>
      <Input ref={search} style={field} placeholder="Search" />
      <Show when={open()}>
        <View focusScope style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, gap: 8 }}>
          <Input ref={to} style={field} autoFocus />
          <Input ref={subject} style={field} />
          <Input ref={body} style={field} multiline />
        </View>
      </Show>
    </View>
  ));
  h.press(search);
  expect(h.focused()).toBe(search);
  setOpen(true);
  h.step();
  expect(h.focused()).toBe(to);
  const order: (Node | null)[] = [];
  for (let i = 0; i < 4; i++) order.push(h.key("Tab").focused());
  expect(order).toEqual([subject, body, to, subject]); // never the search field behind it
  setOpen(false);
  h.step();
  expect(h.focused()).toBe(search);
});

test("the caret goes to the end when the app replaces the text (#30)", () => {
  const [v, setV] = createSignal("");
  const h = app(() => <View><Input value={v()} onChange={setV} autoFocus /></View>);
  h.type("ali");
  setV("Alice <alice@x.com>, ");
  h.step();
  h.type("b");
  expect(v()).toBe("Alice <alice@x.com>, b");
});

test("a filter keeps the caret where the user is typing (#30)", () => {
  let input!: Node;
  const [v, setV] = createSignal("AB");
  const h = app(() => <View><Input ref={input} value={v()} onChange={(t) => setV(t.toUpperCase())} autoFocus /></View>);
  h.key("ArrowLeft");
  h.type("x");
  expect(v()).toBe("AXB");
  expect(input.selection()).toEqual({ start: 2, end: 2 });
  h.type("y");
  expect(v()).toBe("AXYB");
});

test("setSelection places the caret or selects, in UTF-16 units, after the turn's value (#30)", () => {
  let input!: Node;
  const h = app(() => <View><Input ref={input} defaultValue="hello" autoFocus /></View>);
  expect(input.selection()).toEqual({ start: 5, end: 5 });
  input.setSelection(0, 4);
  expect(input.selection()).toEqual({ start: 0, end: 4 });
  h.type("J");
  expect(input.value).toBe("Jo");
  input.setValue("😀 smile");
  input.setSelection(2);
  h.step();
  h.type("!");
  expect(input.value).toBe("😀! smile");
});
