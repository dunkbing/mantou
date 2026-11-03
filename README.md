# Mantou

Native desktop apps in TypeScript, on Bun. Your app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the window and draws the UI on the GPU with wgpu. No webview.

> **Early development.** The threading model works on Linux, macOS and Windows. Solid-style JSX, flexbox layout, text, rounded corners and borders, clipping, presses, keys and the wheel work. There's no text input yet.

```tsx
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
```

## Try it

Needs [Bun](https://bun.sh) 1.4.4 and [Rust](https://rustup.rs).

```bash
bun install
```

```bash
bun run build:core
```

```bash
bun run counter
```

For a bigger app, [Mantou Mail](https://github.com/dunkbing/mantou-mail) is a three-pane mail client built on Mantou as a package.

## Use it in an app

```bash
bun add github:dunkbing/mantou
```

```bash
bunx mantou build-core
```

```bash
bunx mantou run src/main.tsx
```

Set `"jsx": "preserve"` and `"jsxImportSource": "mantou-ui"` in `tsconfig.json`, and preload `mantou-ui/preload` for `bun test` (`bunfig.toml`). Found a bug or need a feature? [Open an issue](https://github.com/dunkbing/mantou/issues/new/choose).

## Docs

The design, the protocol and test results are in [`website/`](website/) (Astro + Starlight, on Bun):

```bash
bun run docs
```

Working on the code, as a person or an agent? Start with [AGENTS.md](AGENTS.md).
