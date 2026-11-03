// The counter, as a Solid component. There's no text yet, so the count shows
// as squares (and in the window title): + adds one, − removes one, ⟲ clears.
import { Index, View, createEffect, createSignal, defineStyle, useUi } from "mantou-ui";

const button = defineStyle({ width: 88, height: 44 });
const dot = defineStyle({ width: 28, height: 28, backgroundColor: "#f59e0b" });

export function Counter() {
  const [count, setCount] = createSignal(0);
  const ui = useUi();
  createEffect(() => ui.title(`Mantou counter · ${count()}`));

  return (
    <View style={{ flexGrow: 1, padding: 24, gap: 16, backgroundColor: "#111318" }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={[button, { backgroundColor: "#16a34a" }]} onPress={() => setCount((n) => n + 1)} />
        <View style={[button, { backgroundColor: "#dc2626" }]} onPress={() => setCount((n) => Math.max(0, n - 1))} />
        <View style={[button, { backgroundColor: "#4b5563" }]} onPress={() => setCount(0)} />
      </View>
      <View
        style={{
          flexGrow: 1,
          flexDirection: "row",
          flexWrap: "wrap",
          alignContent: "start",
          gap: 8,
          padding: 12,
          backgroundColor: "#1f2430",
        }}
      >
        <Index each={Array.from({ length: count() })}>{() => <View style={dot} />}</Index>
      </View>
    </View>
  );
}
