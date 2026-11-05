// The base components in one screen (dunkbing/mantou#22): bun run gallery.
import { Button, Checkbox, Combobox, Dialog, Menu, Progress, RadioGroup, Select, Slider, Spinner, Splitter, Table, Tabs, Text, Toast, Toggle, Tooltip, View, createSignal, type JSX } from "mantou-ui";

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

export function Gallery() {
  const [tab, setTab] = createSignal<"controls" | "layout">("controls");
  const [news, setNews] = createSignal(true);
  const [terms, setTerms] = createSignal(false);
  const [wifi, setWifi] = createSignal(true);
  const [theme, setTheme] = createSignal("system");
  const [volume, setVolume] = createSignal(40);
  const [open, setOpen] = createSignal(false);
  const [pane, setPane] = createSignal(160);
  const [saved, setSaved] = createSignal(0);
  const [lang, setLang] = createSignal<string | undefined>(undefined);
  const [toast, setToast] = createSignal(false);
  const [city, setCity] = createSignal("");
  return (
    <View style={{ flexGrow: 1, minHeight: 0, padding: 24, gap: 16, backgroundColor: "#ffffff" }}>
      <Text style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Components</Text>
      <Tabs tabs={[{ id: "controls", label: "Controls" }, { id: "layout", label: "Layout" }]} value={tab()} onChange={setTab} style={{ flexGrow: 1, minHeight: 0 }}>
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
                  <Text style={{ fontSize: 12, color: "#6b7280" }}>{`Saved ${saved()} times`}</Text>
                </Section>
                <Section title="Checkboxes and switches">
                  <Checkbox checked={news()} onChange={setNews}>Send me news</Checkbox>
                  <Checkbox checked={terms()} onChange={setTerms}>I agree to the terms</Checkbox>
                  <Toggle checked={wifi()} onChange={setWifi}>Wi-Fi</Toggle>
                </Section>
              </View>
              <View style={{ gap: 20, width: 220 }}>
                <Section title="Radio group">
                  <RadioGroup value={theme()} onChange={setTheme} label="Theme" options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Follow the system" }]} />
                </Section>
                <Section title="Slider">
                  <Slider value={volume()} onChange={setVolume} label="Volume" />
                  <Text style={{ fontSize: 12, color: "#6b7280" }}>{`Volume ${volume()}`}</Text>
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
          ) : (
            <View style={{ gap: 16, flexGrow: 1, minHeight: 0 }}>
            <Table style={{ height: 130 }} columns={[{ key: "id", header: "ID", width: 60 }, { key: "name", header: "Name" }, { key: "size", header: "Size", width: 80, align: "end" }]} rows={Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `File ${i + 1}.txt`, size: `${(i * 37) % 900} KB` }))} sort={{ key: "id" }} onSort={() => {}} />
            <Splitter size={pane()} onResize={setPane} min={80} max={400} style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8 }}>
              {[
                <View style={{ padding: 12, backgroundColor: "#f9fafb", flexGrow: 1 }}><Text style={{ color: "#374151" }}>Drag the bar →</Text></View>,
                <View style={{ padding: 12, flexGrow: 1 }}><Text style={{ color: "#374151" }}>{`The left pane is ${Math.round(pane())} px wide.`}</Text></View>,
              ]}
            </Splitter>
            </View>
          )
        }
      </Tabs>
      <Toast open={toast()} onClose={() => setToast(false)}>{`Language: ${lang()}`}</Toast>
      <Dialog open={open()} onClose={() => setOpen(false)} title="Discard the draft?">
        <Text style={{ color: "#4b5563" }}>Your changes will be lost.</Text>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "end" }}>
          <Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
          <Button onPress={() => setOpen(false)}>Discard</Button>
        </View>
      </Dialog>
    </View>
  );
}
