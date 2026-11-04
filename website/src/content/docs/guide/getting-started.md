---
title: Getting started
description: Install Mantou, run an app, and build a small one.
---

Mantou draws its own UI on the GPU in a real window. You write Solid-style JSX in TypeScript; there is no browser or webview.

## Install

You need [Bun](https://bun.sh) 1.4.4 or newer.

```bash
bun add mantou-ui
```

In `tsconfig.json`:

```json
{ "compilerOptions": { "jsx": "preserve", "jsxImportSource": "mantou-ui" } }
```

The native core comes prebuilt for Linux, macOS and Windows. On other platforms, `bunx mantou build-core` builds it (needs [Rust](https://rustup.rs)).

## Your first app

```tsx
// src/main.tsx
import { Text, View, createSignal, run } from "mantou-ui";

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <View style={{ flexGrow: 1, padding: 24, gap: 12, alignItems: "flex-start" }}>
      <Text style={{ fontSize: 32, fontWeight: 700 }}>{count()}</Text>
      <View
        style={{ padding: 12, borderRadius: 8, backgroundColor: "#2563eb", cursor: "pointer" }}
        onPress={() => setCount(count() + 1)}
      >
        <Text style={{ color: "#fff", fontWeight: 600 }}>Add one</Text>
      </View>
    </View>
  );
}

run(() => <App />, { title: "Counter", width: 360, height: 240 });
```

```bash
bunx mantou run src/main.tsx
```

## How it works, in four lines

- Components run once. State is a **signal** (`createSignal`); only the nodes that read a signal update when it changes.
- Everything is a `View`, `Text`, `Input`, `Image`, `Scroll` or `List`, laid out with **flexbox**.
- Text must be inside `<Text>`.
- The window runs on its own thread, so scrolling and typing stay smooth while your code is busy.

## Next

- [Components](/guide/components/) and [styling](/guide/styling/)
- [Events and input](/guide/events/)
- [Menus, dialogs and the clipboard](/guide/platform/)
- [Testing](/guide/testing/) and [shipping an app](/guide/shipping/)
