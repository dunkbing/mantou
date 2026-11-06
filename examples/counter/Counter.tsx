// The counter, as a Solid component: + adds one, − removes one, Reset clears.
// The count shows as a number and as squares (and in the window title).
import { Index, Text, View, createEffect, createSignal, defineStyle, onKey, useUi } from "mantou-ui";

const button = defineStyle({ width: 88, height: 44, justifyContent: "center" });
const label = defineStyle({ color: "#ffffff", fontSize: 15, fontWeight: 600, textAlign: "center" });
const dot = defineStyle({ width: 28, height: 28, backgroundColor: "#f59e0b" });

export function Counter() {
  const [count, setCount] = createSignal(0);
  const ui = useUi();
  createEffect(() => ui.title(`Mantou counter · ${count()}`));
  onKey((e) => {
    if (e.type !== "keyDown") return;
    if (e.key === "+" || e.key === "=" || e.key === "ArrowUp") setCount((n) => n + 1);
    if (e.key === "-" || e.key === "ArrowDown") setCount((n) => Math.max(0, n - 1));
  });

  return (
    <View style={{ flexGrow: 1, padding: 24, gap: 16, backgroundColor: "#111318" }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View testId="add" style={[button, { backgroundColor: "#16a34a" }]} onPress={() => setCount((n) => n + 1)}>
          <Text style={label}>+1</Text>
        </View>
        <View testId="remove" style={[button, { backgroundColor: "#dc2626" }]} onPress={() => setCount((n) => Math.max(0, n - 1))}>
          <Text style={label}>−1</Text>
        </View>
        <View testId="reset" style={[button, { backgroundColor: "#4b5563" }]} onPress={() => setCount(0)}>
          <Text style={label}>Reset</Text>
        </View>
        <Text testId="count" style={{ flexGrow: 1, textAlign: "end", color: "#f9fafb", fontSize: 32, fontWeight: 700 }}>{count()}</Text>
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
