// A small app for `mantou snap`'s tests: state in a module (so scenes can set it), testIds, and a spinner.
import { For, Show, Text, View, createSignal, run } from "mantou-ui";

const [items, setItems] = createSignal(["Milk", "Bread"]);
const [busy, setBusy] = createSignal(false);

export const scenes = {
  empty: () => setItems([]),
  loading: () => setBusy(true),
};

run(
  () => (
    <View style={{ flexGrow: 1, padding: 16, gap: 8, backgroundColor: "#ffffff" }}>
      <Text testId="count" style={{ color: "#111111" }}>{`${items().length} items`}</Text>
      <For each={items()}>{(item) => <Text style={{ color: "#111111" }}>{item}</Text>}</For>
      <View testId="add" role="button" label="Add" onPress={() => setItems([...items(), "Eggs"])} style={{ width: 80, height: 32, backgroundColor: "#2563eb" }} />
      <Show when={busy()}>
        <View testId="spinner" ref={(n) => n.animate("rotate", { from: 0, to: 360, duration: 800, easing: "linear", iterations: Infinity })} style={{ width: 20, height: 20, backgroundColor: "#999999" }} />
      </Show>
    </View>
  ),
  { width: 300, height: 220 },
);
