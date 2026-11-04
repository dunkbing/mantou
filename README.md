# Mantou

Native desktop apps in TypeScript, on Bun. Your app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the window and draws the UI on the GPU with wgpu. No webview.

> **Early development.** The threading model works on Linux, macOS and Windows. Solid-style JSX, flexbox layout, text and app fonts, text input, scrolling, rounded corners, borders and shadows, clipping, presses, keys and the wheel work.

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
bun add mantou-ui
```

```bash
bunx mantou run src/main.tsx
```

The native core comes prebuilt for Linux (x64, arm64), macOS (arm64, x64) and Windows (x64). Elsewhere, or with mantou-ui from GitHub (`bun add github:dunkbing/mantou`), build it once with `bunx mantou build-core` (needs Rust).

Set `"jsx": "preserve"` and `"jsxImportSource": "mantou-ui"` in `tsconfig.json`, and preload `mantou-ui/preload` for `bun test` (`bunfig.toml`). Found a bug or need a feature? [Open an issue](https://github.com/dunkbing/mantou/issues/new/choose).

## Docs

The design, the protocol and test results are in [`website/`](website/) (Astro + Starlight, on Bun):

```bash
bun run docs
```

Working on the code, as a person or an agent? Start with [AGENTS.md](AGENTS.md).
