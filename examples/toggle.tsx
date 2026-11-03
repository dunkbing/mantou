// The README's example: a button that toggles when pressed.
import { Text, View, createSignal, run } from "mantou-ui";

function App() {
  const [on, setOn] = createSignal(false);
  return (
    <View style={{ width: 120, height: 48, borderRadius: 8, justifyContent: "center", backgroundColor: on() ? "#16a34a" : "#4b5563" }} onPress={() => setOn(!on())}>
      <Text style={{ color: "#ffffff", fontWeight: 600, textAlign: "center" }}>{on() ? "On" : "Off"}</Text>
    </View>
  );
}

run(() => <App />);
