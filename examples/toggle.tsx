// The README's example: a box that toggles its colour when pressed.
import { View, createSignal, run } from "mantou-ui";

function App() {
  const [on, setOn] = createSignal(false);
  return <View style={{ width: 120, height: 48, backgroundColor: on() ? "#16a34a" : "#4b5563" }} onPress={() => setOn(!on())} />;
}

run(() => <App />);
