---
title: "The TypeScript runtime"
description: "The bootstrap, Solid-based reactivity, compiled JSX, the public API sketch and node lifetime."
---

## 7. The TypeScript runtime

### 7.1 Bootstrap (written by the CLI)
```ts
// main.ts: runs on Bun's main thread
import { dlopen, FFIType } from "bun:ffi";
const core = dlopen(libPath(), { mt_run: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.void },
                                 mt_exit_code: { args: [], returns: FFIType.i32 } });
new Worker(new URL("./app-worker.ts", import.meta.url).href);   // the app
core.symbols.mt_run(configPtr, configLen);                        // never returns until quit
process.exit(core.symbols.mt_exit_code());
```

### 7.2 Components, reactivity, compiled JSX
- **Reactivity:** Solid's signals in plain JS (`signal`, `computed`, `effect`), re-exported from `mantou-ui`. JavaScriptCore's JIT makes this fast, so there's no reason to move the reactive graph into native code.
- **JSX:** Bun's built-in transform is React-style (`jsx()` calls), so it doesn't fit. A `Bun.plugin` runs `babel-preset-solid` with `generate: "universal"` and `moduleName` pointing at our renderer. The plugin runs in `dev`, in `build` and in the test runner. A faster Oxc-based compiler can come later.
- **Renderer:** `solid-js/universal`'s `createRenderer`, implemented over a **JS mirror tree**. Solid's renderer API needs synchronous `getParentNode`, `getFirstChild` and `getNextSibling`. Each mirror node holds an id, a parent, its children and its handlers. Every mutation updates the mirror and appends an op.

**Status:** implemented as described, with three findings.
- **Bun resolves `solid-js` to Solid's server build.** The package's `node` export condition points at `dist/server.js`, whose effects never re-run. Bun's runtime plugins can't redirect bare imports (`onResolve` never sees them), but `onLoad` does run for files in `node_modules`. So Mantou imports the client build by path (`runtime/solid/solid.ts`), and the plugin rewrites `solid-js` imports in Solid's own `universal` and `store` builds and in app `.tsx` files. Apps import Solid's API from `mantou-ui`.
- **Text leaves.** Solid uses empty text nodes as placeholders, so the mirror tree has text leaves (`TextLeaf`). They send no ops until the core has text; a node inserted next to one is anchored on the next real node.
- **Where it runs.** The Worker's entry (`runtime/worker.ts`) registers the plugin before anything that uses Solid loads, then imports the app; `bun test` preloads it (`bunfig.toml`). Babel adds about 30 MB to the Worker and compiles at start-up: the counter's first frame appears about 150 ms after launch on Linux. Compiling ahead of time for release builds is still to do.

### 7.3 Public API sketch
```tsx
import { run, Window, View, Text, Button, Scroll, signal } from "mantou-ui";

function Counter() {
  const n = signal(0);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <Text style={{ fontSize: 40, fontWeight: 700 }}>{n()}</Text>
      <Button onPress={() => n.set(n() + 1)}>Increment</Button>
    </View>
  );
}

run(() => (
  <Window title="Counter" width={360} height={240}>
    <Counter />
  </Window>
));
```

**Primitives (v1):** `Window`, `View`, `Text` (with nested spans), `Scroll`, `Image`, `Input`/`TextArea`, `List` (virtualized), `Canvas` (later).
**Unstyled behaviour components (v1):** `Button`, `Toggle`, `Checkbox`, `Slider`, `Menu`, `Popover`, `Dialog`, `Tooltip`. They come with their behaviour, focus handling and accessibility, and the app supplies the look.

### 7.4 Node lifetime
- JS allocates node ids from a counter with a free list.
- `REMOVE` only detaches a node, because Solid memos can put removed nodes back. `RELEASE` frees the node and its native resources.
- **Decided (Q3):** a node is released when the Solid owner that created it is disposed (`onCleanup` registered in `createElement`). A `FinalizationRegistry` acts only as a safety net.
  - Development builds count live nodes and warn when the safety net releases a node, because that means a release path was missed.
  - Inserting a node whose owner has been disposed is an error in development builds and a no-op in production.
  - **Status:** release on owner disposal is implemented (`runtime/solid/renderer.ts`); the `FinalizationRegistry` safety net and the development-build checks aren't yet.
  - Nodes aren't freed through GC finalizers alone, because the timing of JavaScriptCore's garbage collection is unpredictable, and native resources (GPU textures, text layouts) would linger.
