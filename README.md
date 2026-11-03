# Mantou

Native desktop apps in TypeScript, on Bun. Your app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the window and draws the UI on the GPU with wgpu. No webview.

> **Early development.** The threading model works on Linux, macOS and Windows. Solid-style JSX, flexbox layout, a rectangle renderer and presses work. There's no text yet.

```tsx
import { View, createSignal, run } from "mantou-ui";

function App() {
  const [on, setOn] = createSignal(false);
  return <View style={{ width: 120, height: 48, backgroundColor: on() ? "#16a34a" : "#4b5563" }} onPress={() => setOn(!on())} />;
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

## Docs

The design, the protocol and test results are in [`website/`](website/) (Astro + Starlight, on Bun):

```bash
bun run docs
```

Working on the code, as a person or an agent? Start with [AGENTS.md](AGENTS.md).
