// The base components in one screen (dunkbing/mantou#22): bun run gallery.
import { Accordion, Avatar, Badge, Button, Checkbox, Combobox, Dialog, HoverCard, Kbd, Menu, Popover, Progress, RadioGroup, RollingNumber, SegmentedControl, Select, ShortcutRecorder, Slider, SortableList, Spinner, Splitter, Table, Tabs, Text, Toast, Toggle, Tooltip, TreeView, View, createSignal, setTheme, theme, type JSX } from "mantou-ui";

export type GalleryTab = "controls" | "layout" | "more";
/** The tab showing (module state, so `mantou snap --scene` can pick one). */
export const [tab, setTab] = createSignal<GalleryTab>("controls");

const fileRows = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `File ${i + 1}.txt`, size: `${(i * 37) % 900} KB` }));

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: 600, color: theme.dimText, textTransform: "uppercase", letterSpacing: 0.5 }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

export function Gallery() {
  const [news, setNews] = createSignal(true);
  const [terms, setTerms] = createSignal(false);
  const [wifi, setWifi] = createSignal(true);
  const [scheme, setScheme] = createSignal<"light" | "dark" | "system">("light");
  const pick = (v: string) => {
    if (v === "light" || v === "dark" || v === "system") (setScheme(v), setTheme(v));
  };
  const [volume, setVolume] = createSignal(40);
  const [open, setOpen] = createSignal(false);
  const [pane, setPane] = createSignal(160);
  const [saved, setSaved] = createSignal(0);
  const [lang, setLang] = createSignal<string | undefined>(undefined);
  const [toast, setToast] = createSignal(false);
  const [city, setCity] = createSignal("");
  const [picked, setPicked] = createSignal<Set<number>>(new Set([2]));
  return (
    <View style={{ flexGrow: 1, minHeight: 0, padding: 24, gap: 16, backgroundColor: theme.background }}>
      <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>Components</Text>
      <Tabs tabs={[{ id: "controls", label: "Controls" }, { id: "layout", label: "Layout" }, { id: "more", label: "More" }]} value={tab()} onChange={setTab} style={{ flexGrow: 1, minHeight: 0 }}>
        {(id) =>
          id === "controls" ? (
            <View style={{ flexDirection: "row", gap: 40 }}>
              <View style={{ gap: 20, width: 220 }}>
                <Section title="Buttons">
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button onPress={() => setSaved(saved() + 1)}>Save</Button>
                    <Button variant="secondary" onPress={() => setOpen(true)}>Open dialog</Button>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button variant="ghost">Ghost</Button>
                    <Button disabled>Disabled</Button>
                  </View>
                  <Text style={{ fontSize: 12, color: theme.dimText }}>{`Saved ${saved()} times`}</Text>
                </Section>
                <Section title="Checkboxes and switches">
                  <Checkbox checked={news()} onChange={setNews}>Send me news</Checkbox>
                  <Checkbox checked={terms()} onChange={setTerms}>I agree to the terms</Checkbox>
                  <Toggle checked={wifi()} onChange={setWifi}>Wi-Fi</Toggle>
                </Section>
              </View>
              <View style={{ gap: 20, width: 220 }}>
                <Section title="Radio group">
                  <RadioGroup value={scheme()} onChange={pick} label="Theme" options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Follow the system" }]} />
                </Section>
                <Section title="Slider">
                  <Slider value={volume()} onChange={setVolume} label="Volume" />
                  <Text style={{ fontSize: 12, color: theme.dimText }}>{`Volume ${volume()}`}</Text>
                </Section>
                <Section title="Select">
                  <Select value={lang()} onChange={(v) => (setLang(v), setToast(true))} placeholder="Language" options={[{ value: "en", label: "English" }, { value: "vi", label: "Tiếng Việt" }, { value: "ja", label: "日本語" }]} />
                </Section>
                <Section title="Menu and Combobox">
                  <Menu items={[{ id: "rename", label: "Rename" }, { id: "-", label: "", separator: true }, { id: "del", label: "Delete" }]}>Actions</Menu>
                  <Combobox value={city()} onChange={setCity} placeholder="City" options={["Hanoi", "Ho Chi Minh City", "Hue", "Da Nang", "Tokyo", "Osaka"]} />
                </Section>
                <Section title="Progress">
                  <Progress value={volume() / 100} />
                  <Spinner />
                </Section>
                <Section title="Tooltip">
                  <Tooltip text="Copies the link to the clipboard">
                    <Button variant="secondary">Hover me</Button>
                  </Tooltip>
                </Section>
              </View>
            </View>
          ) : id === "more" ? (
            <More />
          ) : (
            <View style={{ gap: 16, flexGrow: 1, minHeight: 0 }}>
            <Table testId="files" style={{ height: 130 }} columns={[{ key: "id", header: "ID", width: 60 }, { key: "name", header: "Name" }, { key: "size", header: "Size", width: 80, align: "end" }]} rows={fileRows} rowKey={(r) => r.id} selection={picked()} onSelectionChange={setPicked} sort={{ key: "id" }} onSort={() => {}} />
            <Splitter size={pane()} onResize={setPane} min={80} max={400} style={{ borderWidth: 1, borderColor: theme.divider, borderRadius: 8 }}>
              {[
                <View style={{ padding: 12, backgroundColor: theme.surfaceAlt, flexGrow: 1 }}><Text style={{ color: theme.text }}>Drag the bar →</Text></View>,
                <View style={{ padding: 12, flexGrow: 1 }}><Text style={{ color: theme.text }}>{`The left pane is ${Math.round(pane())} px wide.`}</Text></View>,
              ]}
            </Splitter>
            </View>
          )
        }
      </Tabs>
      <Toast open={toast()} onClose={() => setToast(false)}>{`Language: ${lang()}`}</Toast>
      <Dialog open={open()} onClose={() => setOpen(false)} title="Discard the draft?">
        <Text style={{ color: theme.dimText }}>Your changes will be lost.</Text>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "end" }}>
          <Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
          <Button onPress={() => setOpen(false)}>Discard</Button>
        </View>
      </Dialog>
    </View>
  );
}

const files = [
  { id: "src", label: "src", children: [{ id: "app", label: "App.tsx" }, { id: "state", label: "state.ts" }, { id: "ui", label: "ui", children: [{ id: "button", label: "Button.tsx" }, { id: "list", label: "List.tsx" }] }] },
  { id: "tests", label: "tests", children: [{ id: "app-test", label: "App.test.tsx" }] },
  { id: "readme", label: "README.md" },
  { id: "pkg", label: "package.json" },
];

/** The newer components. */
function More() {
  const [view, setView] = createSignal<"day" | "week" | "month">("week");
  const [sections, setSections] = createSignal<string[]>(["general"]);
  const [shortcut, setShortcut] = createSignal<string | null>("Mod+K");
  const [pop, setPop] = createSignal(false);
  const [count, setCount] = createSignal(1284);
  const [file, setFile] = createSignal<string | null>("app");
  const [todo, setTodo] = createSignal(["Write the docs", "Fix the build", "Ship it"]);
  const reorder = (from: number, to: number) => {
    const next = [...todo()];
    next.splice(to, 0, ...next.splice(from, 1));
    setTodo(next);
  };
  return (
    <View style={{ flexDirection: "row", gap: 32, flexGrow: 1, minHeight: 0 }}>
      <View style={{ gap: 18, width: 230 }}>
        <Section title="Segmented control">
          <SegmentedControl testId="view" value={view()} onChange={setView} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        </Section>
        <Section title="Badges and avatars">
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Avatar name="Ada Lovelace" />
            <Avatar name="Grace Hopper" />
            <Badge tone="accent">3</Badge>
            <Badge tone="success">Live</Badge>
            <Badge>Beta</Badge>
          </View>
        </Section>
        <Section title="Shortcuts">
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: theme.dimText }}>Search</Text>
            <Kbd keys="Mod+K" />
          </View>
          <ShortcutRecorder testId="shortcut" value={shortcut()} onChange={setShortcut} />
        </Section>
        <Section title="Rolling number">
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <RollingNumber testId="count" value={count()} />
            <Button variant="secondary" onPress={() => setCount(count() + 17)}>+17</Button>
          </View>
        </Section>
        <Section title="Popover and hover card">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Popover open={pop()} onClose={() => setPop(false)} content={() => <><Text style={{ fontWeight: 600, color: theme.text }}>Share</Text><Text style={{ color: theme.dimText }}>Anyone with the link can view.</Text><Button onPress={() => setPop(false)}>Copy link</Button></>}>
              <Button variant="secondary" onPress={() => setPop(true)}>Share…</Button>
            </Popover>
            <HoverCard content={() => <View style={{ flexDirection: "row", gap: 10 }}><Avatar name="Ada Lovelace" size={40} /><View style={{ gap: 2 }}><Text style={{ fontWeight: 600, color: theme.text }}>Ada Lovelace</Text><Text style={{ color: theme.dimText, fontSize: 12 }}>Wrote the first program</Text></View></View>}>
              <Text style={{ color: theme.accent, paddingTop: 7 }}>@ada</Text>
            </HoverCard>
          </View>
        </Section>
      </View>
      <View style={{ gap: 18, width: 230, minHeight: 0 }}>
        <Section title="Tree">
          <TreeView testId="files" items={files} defaultExpanded={["src"]} selected={file()} onSelect={setFile} style={{ height: 150, flexGrow: 0, borderWidth: 1, borderColor: theme.divider }} />
        </Section>
        <Section title="Accordion">
          <Accordion
            open={sections()}
            onChange={setSections}
            items={[
              { id: "general", title: "General", content: () => <Text style={{ color: theme.dimText }}>Name, language and region.</Text> },
              { id: "privacy", title: "Privacy", content: () => <Text style={{ color: theme.dimText }}>Who can see what.</Text> },
            ]}
          />
        </Section>
        <Section title="Sortable list (drag)">
          <SortableList items={todo()} itemHeight={30} onReorder={reorder} style={{ borderWidth: 1, borderColor: theme.divider, borderRadius: 8, backgroundColor: theme.surface }}>
            {(item) => (
              <View style={{ height: 30, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 10, backgroundColor: theme.surface, borderRadius: 8 }}>
                <Text style={{ color: theme.dimText }}>⋮⋮</Text>
                <Text style={{ color: theme.text }}>{item}</Text>
              </View>
            )}
          </SortableList>
        </Section>
      </View>
    </View>
  );
}
