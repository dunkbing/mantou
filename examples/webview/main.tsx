// A native web view next to Mantou content: bun run webview
import { Text, View, WebView, createSignal, run } from "mantou-ui";

function App() {
  const [title, setTitle] = createSignal("loading…");
  const [heard, setHeard] = createSignal("");
  return (
    <View style={{ flexGrow: 1, padding: 12, gap: 8 }}>
      <Text style={{ fontSize: 14 }}>{title()}   {heard()}</Text>
      <WebView
        native
        html="<body style='font:16px sans-serif;padding:16px'><h2>Hello from a web view</h2><p>Select this text, then <button onclick=&quot;ipc.postMessage('clicked')&quot;>tell the app</button></p><input placeholder='type here'>"
        style={{ flexGrow: 1 }}
        onNavigate={(_, t) => setTitle(t || "(no title)")}
        onMessage={(m) => setHeard(`page said: ${m}`)}
      />
    </View>
  );
}

run(App, { title: "WebView", width: 640, height: 420 });
