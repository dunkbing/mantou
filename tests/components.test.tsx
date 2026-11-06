// The newer base components on the real core, headless (runtime/widgets/): each one's pointer and keyboard behaviour.
import "mantou-ui/images";
import { afterEach, expect, test } from "bun:test";
import { Table, Accordion, Avatar, Badge, HoverCard, Kbd, Popover, RollingNumber, SegmentedControl, ShortcutRecorder, SortableList, Text, TreeView, View, createSignal, formatShortcut, mount, type JSX, type TreeItem, type TreeViewHandle } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app(ui: () => JSX.Element, size = { width: 400, height: 300 }) {
  const h = new HeadlessCore(size);
  open.push(h);
  mount(h.ui, ui);
  return h.step();
}

const mac = process.platform === "darwin";

test("Badge, Avatar and Kbd show what they're given", () => {
  const h = app(() => (
    <View style={{ padding: 10, gap: 8 }}>
      <Badge testId="badge" tone="danger">3</Badge>
      <Avatar testId="avatar" name="Ada Lovelace" />
      <Kbd testId="kbd" keys="Mod+Shift+K" />
    </View>
  ));
  const t = h.treeText();
  expect(t).toMatch(/\[badge\][^\n]*role=status/);
  expect(t).toContain('"3"');
  expect(t).toMatch(/\[avatar\][^\n]*role=image label="Ada Lovelace"/);
  expect(t).toContain('"AL"');
  expect(formatShortcut("Mod+Shift+K")).toEqual(mac ? ["⌘", "⇧", "K"] : ["Ctrl", "Shift", "K"]);
  expect(t).toMatch(new RegExp(`\\[kbd\\][^\\n]*label="${mac ? "⌘⇧K" : "Ctrl\\+Shift\\+K"}"`));
});

test("ShortcutRecorder records a combination, ignores plain letters, Escape cancels, Backspace clears", () => {
  const [value, setValue] = createSignal<string | null>(null);
  const h = app(() => <ShortcutRecorder testId="rec" value={value()} onChange={setValue} />);
  h.press("rec");
  expect(h.treeText()).toContain('"Press keys…"');
  h.key("a"); // not a shortcut on its own
  expect(value()).toBeNull();
  h.key("k", { primary: true, shift: true });
  expect(value()).toBe("Mod+Shift+K");
  h.press("rec").key("Escape");
  expect(value()).toBe("Mod+Shift+K");
  h.press("rec").key("Backspace");
  expect(value()).toBeNull();
  h.press("rec").key("F5");
  expect(value()).toBe("F5");
});

test("SegmentedControl: a press or the arrows choose, and the thumb slides there", () => {
  const [v, setV] = createSignal<"day" | "week" | "month">("day");
  const h = app(() => (
    <View style={{ padding: 10 }}>
      <SegmentedControl testId="seg" value={v()} onChange={setV} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
    </View>
  ));
  const thumbX = () => h.tree("seg")!.children[0].rect![0];
  const x0 = thumbX();
  h.press([h.rect("seg")![2] - 20, 26]);
  expect(v()).toBe("month");
  h.step(1000);
  expect(thumbX()).toBeGreaterThan(x0 + 100);
  h.key("ArrowLeft");
  expect(v()).toBe("week");
  expect(h.treeText()).toMatch(/role=radioGroup/);
});

test("Accordion opens one section at a time unless it's multiple", () => {
  const [openIds, setOpen] = createSignal<string[]>([]);
  const items = ["a", "b"].map((id) => ({ id, title: `Section ${id}`, content: () => <Text testId={`body-${id}`}>{`Body ${id}`}</Text> }));
  const h = app(() => <Accordion testId="acc" items={items} open={openIds()} onChange={setOpen} />);
  expect(h.find("body-a")).toBeNull();
  h.press(h.tree("acc-a")!.children[0].children[0].rect!.slice(0, 2).map((v) => v + 5) as [number, number]);
  expect(openIds()).toEqual(["a"]);
  expect(h.find("body-a")).not.toBeNull();
  expect(h.treeText()).toMatch(/role=button expanded/);
  h.press(h.tree("acc-b")!.children[0].children[0].rect!.slice(0, 2).map((v) => v + 5) as [number, number]);
  expect(openIds()).toEqual(["b"]);
});

test("Popover opens by its anchor, and Escape or a press outside closes it", () => {
  const [shown, setShown] = createSignal(false);
  const h = app(() => (
    <View style={{ padding: 10 }}>
      <Popover testId="pop" open={shown()} onClose={() => setShown(false)} content={() => <Text>Details</Text>}>
        <View testId="anchor" onPress={() => setShown(true)} style={{ width: 60, height: 24 }} />
      </Popover>
    </View>
  ));
  h.press("anchor");
  expect(h.rect("pop")![1]).toBeGreaterThanOrEqual(h.rect("anchor")![3]); // below it
  h.key("Escape");
  expect(shown()).toBe(false);
  h.press("anchor").press([350, 250]);
  expect(shown()).toBe(false);
});

test("Popover goes above its anchor when there's no room below", () => {
  const [shown, setShown] = createSignal(true);
  const h = app(() => (
    <View style={{ flexGrow: 1, justifyContent: "end", padding: 10 }}>
      <Popover testId="pop" open={shown()} onClose={() => setShown(false)} content={() => <View style={{ height: 120 }} />}>
        <View testId="anchor" style={{ width: 60, height: 24 }} />
      </Popover>
    </View>
  ));
  h.step();
  expect(h.rect("pop")![3]).toBeLessThanOrEqual(h.rect("anchor")![1]); // above it
});

test("HoverCard opens after the pointer rests, and closes after it leaves", async () => {
  const h = app(() => (
    <View style={{ padding: 10 }}>
      <HoverCard testId="card" openDelay={10} closeDelay={10} content={() => <Text>Ada Lovelace</Text>}>
        <Text testId="name">@ada</Text>
      </HoverCard>
    </View>
  ));
  h.hover("name");
  await Bun.sleep(30);
  h.step();
  expect(h.find("card")).not.toBeNull();
  h.hover([350, 280]);
  await Bun.sleep(30);
  h.step();
  expect(h.find("card")).toBeNull();
});

const files: TreeItem[] = [
  { id: "src", label: "src", children: [{ id: "app", label: "App.tsx" }, { id: "lib", label: "lib", children: [{ id: "util", label: "util.ts" }] }] },
  { id: "readme", label: "README.md" },
];

test("TreeView: the arrows move, open and close; typing jumps; reveal opens the way", () => {
  let tree!: TreeViewHandle;
  const [sel, setSel] = createSignal<string | null>(null);
  const h = app(() => (
    <View style={{ padding: 10, height: 280 }}>
      <TreeView testId="files" items={files} selected={sel()} onSelect={setSel} ref={(t) => (tree = t)} />
    </View>
  ));
  h.press("files-src");
  expect(sel()).toBe("src");
  expect(h.find("files-app")).toBeNull(); // closed
  h.key("ArrowRight");
  expect(h.find("files-app")).not.toBeNull(); // opened
  h.key("ArrowRight").key("ArrowDown");
  expect(sel()).toBe("lib");
  h.key("ArrowLeft"); // lib is closed: to its parent
  expect(sel()).toBe("src");
  h.key("r"); // the next item starting with r
  expect(sel()).toBe("readme");
  tree.reveal("util");
  h.step();
  expect(sel()).toBe("util");
  expect(h.find("files-util")).not.toBeNull();
  expect(h.treeText()).toMatch(/\[files-lib\][^\n]*role=treeItem[^\n]*expanded/);
  expect(h.accessibility()).toContain('TreeItem "util.ts" selected');
});

test("RollingNumber rolls its digits to the new value", () => {
  const [n, setN] = createSignal(99);
  const h = app(() => (
    <View style={{ padding: 10 }}>
      <RollingNumber testId="num" value={n()} size={20} />
    </View>
  ));
  // Columns from the right (they're laid out right to left).
  const columns = () => h.tree("num")!.children.map((c) => c.children[0]?.rect?.[1]);
  expect(h.tree("num")!.label).toBe("99");
  setN(100);
  h.step();
  const mid = columns();
  h.step(1500);
  const end = columns();
  expect(h.tree("num")!.label).toBe("100");
  expect(end.length).toBe(3);
  // The last digit rolled from 9 to 0: it was still on its way, and ends at the top (0 shows).
  expect(mid[0]).not.toBe(end[0]);
  expect(end[0]).toBe(h.rect("num")![1]);
});

test("SortableList: dragging a row past another reorders, and Alt+arrows move the focused one", () => {
  const [items, setItems] = createSignal(["one", "two", "three"]);
  const reorder = (from: number, to: number) => {
    const next = [...items()];
    next.splice(to, 0, ...next.splice(from, 1));
    setItems(next);
  };
  const h = app(() => (
    <View style={{ padding: 10 }}>
      <SortableList testId="rows" items={items()} itemHeight={30} onReorder={reorder}>
        {(item) => <Text style={{ height: 30 }}>{item}</Text>}
      </SortableList>
    </View>
  ));
  const [x, y] = h.center("rows-one");
  h.pointer("down", x, y).pointer("move", x, y + 35).pointer("move", x, y + 70).pointer("up", x, y + 70);
  expect(items()).toEqual(["two", "three", "one"]);
  h.press("rows-two").key("ArrowDown", { alt: true });
  expect(items()).toEqual(["three", "two", "one"]);
});

const people = ["Ada", "Grace", "Alan", "Edsger", "Barbara"].map((name, i) => ({ id: `p${i}`, name, age: 30 + i }));

function table(extra: Partial<Parameters<typeof Table<(typeof people)[number], string>>[0]> = {}) {
  const [sel, setSel] = createSignal<Set<string>>(new Set());
  const events: string[] = [];
  const h = app(() => (
    <View style={{ padding: 10, height: 280 }}>
      <Table
        testId="people"
        columns={[{ key: "name", header: "Name" }, { key: "age", header: "Age", width: 60, align: "end" }]}
        rows={people}
        rowKey={(r) => r.id}
        selection={sel()}
        onSelectionChange={setSel}
        onRowDoubleClick={(r) => events.push(`open ${r.name}`)}
        onRowContextMenu={(r, _i, at) => events.push(`menu ${r.name} ${at.x > 0}`)}
        rowLabel={(r) => `${r.name}, ${r.age}`}
        style={{ flexGrow: 1 }}
        {...extra}
      />
    </View>
  ));
  return { h, sel: () => [...sel()].sort(), events };
}

test("Table selects as file lists do: a press, Shift for a range, ⌘/Ctrl to add or remove", () => {
  const { h, sel } = table();
  h.press("people-p1");
  expect(sel()).toEqual(["p1"]);
  // Shift+press: the range from the last press.
  h.press("people-p3", { shift: true });
  expect(sel()).toEqual(["p1", "p2", "p3"]);
  h.press("people-p2", { primary: true });
  expect(sel()).toEqual(["p1", "p3"]);
  // The keyboard: ↓ moves and selects one, Shift+↓ extends, ⌘/Ctrl+A selects all.
  h.key("ArrowDown");
  expect(sel()).toEqual(["p3"]);
  h.key("ArrowDown", { shift: true });
  expect(sel()).toEqual(["p3", "p4"]);
  h.key("a", { primary: true });
  expect(sel()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
});

test("Table rows: double click opens, a secondary press asks for a menu, and screen readers hear a label", () => {
  const { h, events } = table();
  const [x, y] = h.center("people-p0");
  h.pointer("down", x, y).pointer("up", x, y).pointer("down", x, y).pointer("up", x, y);
  h.pointerButton("down", 2, x, y).pointerButton("up", 2, x, y);
  expect(events).toEqual(["open Ada", "menu Ada true"]);
  expect(h.accessibility()).toContain('ListItem "Ada, 30"');
});

test("Table looks: header, cells and rows take styles; a flat table has no border", () => {
  const { h } = table({
    headerStyle: { backgroundColor: "#000000", height: 24 },
    headerTextStyle: { fontSize: 11, color: "#ffffff" },
    cellPadding: 4,
    striped: false,
    style: { flexGrow: 1, borderWidth: 0, borderRadius: 0 },
    rowStyle: (_r, i) => (i === 0 ? { backgroundColor: "#ff0000" } : {}),
  });
  const header = h.tree("people")!.children[0];
  expect(header.rect![3]).toBe(24);
  expect(h.tree("people-p1")!.children[0].children[0].rect![0]).toBe(10 + 4); // the cell's padding
  expect(h.capture().at(20, 40)).toEqual([255, 0, 0, 255]); // the first row's own style
}, 60_000);
