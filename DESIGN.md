# Mantou — a native GUI framework for Bun + TypeScript

_Architecture & design_

**Status:** Draft v0.5 · 2026-11-03 (v0.2: testing design, §12 · v0.3: named Mantou · v0.4: open questions decided, §17 · v0.5: M0 results on Linux, §4)
**Name:** Mantou (馒头), the plain Chinese steamed bun: Mantou provides a plain, unstyled base, and the app supplies the filling (§7.3).
**Packages:** npm `mantou-ui` (the bare `mantou` is taken, see Q1) · CLI `mantou` · Rust crates `mantou-*` · C ABI prefix `mt_`
**Scope of this draft:** desktop (macOS, Windows, Linux). Mobile and web are out of scope for v1.

---

## 1. Summary

Mantou lets you write desktop apps in TypeScript and TSX, run them on Bun, and show UI that Mantou draws itself on the GPU. It never shows a webview. It has three parts:

- **A thin native core** in Rust, compiled to a C-ABI dynamic library and loaded with `bun:ffi`. It owns the OS event loop, the windows, the UI tree, layout, text, drawing, scrolling, animations, input methods (IME) and accessibility.
- **A TypeScript runtime** that runs the app inside a Bun `Worker`. It turns compiled TSX and fine-grained signals into a stream of tree **ops** and sends them to the core in **one FFI call per JS turn**.
- **A small bootstrap** on Bun's main thread. It starts the Worker and then gives the main thread to the native event loop for the rest of the process's life.

The main thread never runs app JavaScript and never waits for it. That keeps scrolling, resizing and animation smooth while the app's JS is busy or paused for garbage collection.

## 2. Goals and non-goals

### Goals
- Cross-platform desktop apps written entirely in TypeScript/TSX, with full access to npm, Node APIs and Web APIs through Bun.
- Self-drawn UI with an app-owned look, the same on every platform. One rendering code path, built on wgpu.
- Smooth by construction: scrolling, resizing, transitions and input handling must not depend on the JS thread.
- Idle at about 0% CPU. Nothing polls; all work is driven by events.
- Fine-grained updates: no virtual-DOM diffing; a signal change sends only the ops it causes.
- Accessible from v1: screen readers on all three desktops through AccessKit.
- Ships as an app bundle or installer per platform, built from one command.

### Non-goals (v1)
- Wrapping OS widgets (NSButton, Win32 controls, GTK widgets). This is not a "native widgets" toolkit.
- iOS and Android. Bun doesn't run there; see §15 for what this rules out.
- Running in a browser.
- Pixel-identical text to each platform's own toolkit (see §8.5 for the trade-off).

## 3. Background and prior art

| | **MyGo** (`egoist/mygo`, @48da1ba) | **NSH** (`longbridge/nsh`, @b13c8c2) | **Mantou** |
|---|---|---|---|
| Who owns the process | Go | Rust host | Bun; the main thread is handed to the native loop |
| Where app code runs | Go, on the main thread | QuickJS on an engine thread | Bun `Worker` (JavaScriptCore, JIT) |
| UI model | Immediate-mode API, rebuilds the tree every frame | Compiled JSX + Solid-style signals (in Rust) | Compiled JSX + Solid signals (in JS) |
| Tree, layout, text | Go: flexbox/grid, OS text engines | Rust: Taffy, OS text engines | Rust: Taffy, parley |
| Drawing | Own GPU renderer (Metal/D3D11/GL) + CPU fallback | Native views per node (AppKit, GTK 4, Direct2D) or GPUI | wgpu, MyGo-style instanced quads |
| Web/Node APIs | n/a | Re-implemented in Rust | Provided by Bun |

### What we take from each

- **From MyGo:** frames are drawn only when asked for, so an idle window costs nothing. The scene is a flat list of operations. The renderer draws one instanced quad per operation with a signed-distance-field (SDF) shader for rounded rects, borders and shadows, plus glyph atlases. Layout results are cached and reused when an element hasn't changed.
- **From NSH:**
  - The app UI never waits for JS. One JS turn produces one commit.
  - The core keeps a shadow tree; JS only sends mutations.
  - Text is measured off the main thread and cached by content hash plus width.
  - Removing a node only detaches it; freeing it is a separate step.
  - A node already in place is never re-inserted.
  - During a resize, the app waits a bounded time for the new layout.
  - Layout rounds to device pixels, not whole points.
- **Electrobun and `webview-bun`** prove that Bun desktop apps can be packaged and shipped. They render in a webview, so they're useful for packaging ideas, not for rendering.

## 4. The defining constraint: who owns the main thread

- **macOS:** AppKit must run on the main thread, inside a run loop that never returns (`[NSApp run]`).
- **Linux:** GTK and Wayland/X11 integrations expect the same.
- **Windows:** windows are tied to the thread that created them.
- **Bun:** the entry script runs on the main thread. Bun has **no public API** to run one tick of its event loop, and it doesn't expose its epoll/kqueue file descriptor.

Calling the native loop from main-thread JS would freeze Bun's timers, promises and I/O. Polling the native loop from a JS timer trades idle CPU against input latency.

**Decision:** the bootstrap starts a `Worker` running the app, then calls the core's `mt_run()` on the main thread. That call blocks for the life of the process. All app JavaScript runs in the Worker.

**Validated (Linux, Bun 1.4.4):** with the main thread blocked inside an FFI call, the Worker's timers kept their schedule and its async I/O completed. A native pthread also woke the Worker through `JSCallback({ threadsafe: true })`. The spike code is in Appendix A.
**Not yet validated:** macOS, where Bun's main thread must also be AppKit's main thread, and Windows. Both are milestone M0 (§13).

**M0 spike (2026-11-03), Linux:** passes with a real winit window and wgpu, under Xvfb with Mesa lavapipe; see `README.md` and `docs/m0/`.
- winit's event loop runs on Bun's main thread inside `mt_run`.
- An idle window draws 0 frames and causes 0 wake-ups.
- `fetch` and timers in the Worker keep working through live resizes.
- With the Worker blocked in a busy loop for 1 s, the main thread kept drawing, and wake-ups coalesced to exactly one.

macOS and Windows are wired into CI (`.github/workflows/m0.yml`) but haven't run yet.

## 5. Architecture overview

```
┌──────────────────────────────── one process ────────────────────────────────┐
│                                                                             │
│  MAIN THREAD (native loop, no JS after bootstrap)                           │
│   winit event loop · windows · wgpu surfaces · IME · AccessKit · menus      │
│   ├─ input  ──► hit-test / scroll / focus in core ──► event queue ─► wake ──┼──┐
│   ├─ resize ──► lock tree, relayout (bounded wait) ──► repaint              │  │
│   └─ RedrawRequested ──► composite latest scene (+ native scroll/anim) ──►  │  │
│                           wgpu present                                      │  │
│                        ▲                                                    │  │
│        EventLoopProxy  │ "scene ready" / window commands                    │  │
│                        │                                                    │  │
│  WORKER THREAD (Bun Worker: the app)                                        │  │
│   TSX components ─► Solid signals ─► renderer ─► op encoder (ArrayBuffer)   │  │
│        ▲                                         │ queueMicrotask           │  │
│        │                                         ▼                          │  │
│   dispatch handlers ◄─ mt_take_events()     mt_commit(ptr,len) ─────────────┼──┤
│        ▲                                         │ (runs in core, on this   │  │
│        └──────── onWake (threadsafe JSCallback) ◄┘  thread: apply ops,      │  │
│                                                     layout, text, scene)  ◄─┼──┘
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Threads and who owns what

| Thread | Runs | Owns |
|---|---|---|
| Main | winit loop; compositing and present; IME; AccessKit adapter; menus, dialogs, clipboard | Windows, wgpu device/queue/surfaces, GPU textures and atlases, scroll offsets, running animations |
| Worker (JS) | App code; Solid; op encoding. The core's `mt_commit` runs here synchronously | JS mirror tree, signals, handlers |
| Core worker pool (optional, later) | Image decoding, font loading | — |

The **shadow tree** (nodes, styles, layout results, text layouts) sits behind a `Mutex` in the core. `mt_commit` (Worker thread) and resize relayout (main thread) both take that lock. The **scene** that drawing reads is an immutable snapshot (`Arc<Scene>`) handed from commit to the main thread, so drawing never needs the lock.

### 5.2 Invariants
1. The main thread never calls into JS, and it never waits on the tree lock longer than one commit's layout. During a resize it waits at most about 16 ms, then draws what it has.
2. JS never calls platform APIs directly. Everything goes through the core, which forwards to the main thread through winit's `EventLoopProxy`.
3. Exactly one `mt_commit` per JS turn that changed anything. Zero FFI calls for turns that changed nothing.
4. Scrolling, compositor-only animations (transform, opacity) and hover effects driven by native state need no JS round trip.
5. A node is never re-inserted where it already is. A move is an `INSERT` with a new `before` anchor.
6. The Worker reports its own failures. Once `mt_run` starts, the main thread never reads Worker messages or `error` events, so an uncaught error or rejection in the Worker logs and calls `mt_quit(70)` itself. The bootstrap waits for the Worker's `ready` message before it blocks. (Found in M0.)

## 6. The native core (Rust)

### 6.1 Crates

| Concern | Crate | Notes |
|---|---|---|
| Windows, input, IME, event loop | `winit` | `run_app` on the main thread; `EventLoopProxy` for wake-ups from other threads |
| GPU | `wgpu` | Metal / D3D12 / Vulkan, with GL as a fallback; WGSL shaders |
| Layout | `taffy` | flexbox, grid, block. Do our own rounding to device pixels (an NSH pitfall) |
| Text layout and shaping | `parley` + `fontique` | Bidi, line breaking, font fallback. `cosmic-text` is the alternative |
| Glyph rasterization | `swash` | Coverage + color (emoji) atlases |
| Accessibility | `accesskit` + `accesskit_winit` | VoiceOver, Narrator/UIA, Orca/AT-SPI |
| Menus, tray | `muda`, `tray-icon` | |
| Dialogs, clipboard | `rfd`, `arboard` | |
| Images | `image` (PNG/JPEG/WebP), `resvg` (SVG) | Decoded off the main thread |

### 6.2 Layout of the core's code
```
core/
  crates/
    mantou-ffi        C ABI surface (cdylib); the only crate with `extern "C"`
    mantou-tree       shadow tree, op decoder, styles, Taffy integration, hit-testing, focus
    mantou-text       parley wrapper, measure cache, glyph atlas management
    mantou-scene      immutable scene / display list built from the tree after layout
    mantou-render     wgpu renderer: instanced SDF quads, glyphs, images, clips, layers
    mantou-platform   winit app, windows, IME, AccessKit, menus, dialogs, clipboard
```
`mantou-tree`, `mantou-text` and `mantou-scene` have no platform dependencies, so they can be tested headless (§12).

### 6.3 C ABI

`bun:ffi` can't pass structs by value. Every call therefore takes only scalars, pointers and lengths.

```c
uint32_t mt_abi_version(void);

// Bootstrap (main thread)
void     mt_run(const uint8_t* config, uint32_t len);   // blocks until quit; returns exit code via mt_exit_code()
int32_t  mt_exit_code(void);

// Worker thread
void     mt_set_wake(void (*wake)(void));                // threadsafe JSCallback pointer
void     mt_commit(const uint8_t* ops, uint32_t len);   // apply ops, layout, build scene, request redraw
uint32_t mt_take_events(const uint8_t** out);            // swaps the event buffer; *out valid until the next call
uint32_t mt_measure_text(const uint8_t* req, uint32_t len, uint8_t* out, uint32_t cap); // optional, for app-side measuring
void     mt_quit(int32_t code);
```

Both threads `dlopen` the same library. A commit made before `mt_run` has started is queued.

**Revision planned (see §12.2):** the core becomes multi-instance. Every function will take an instance handle: `mt_run` creates the app instance, and `mt_headless_new` creates headless instances for tests. The signatures above leave the handle out for brevity.

## 7. The TypeScript runtime

### 7.1 Bootstrap (generated by the CLI)
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
- **Reactivity:** Solid's signals in plain JS (`signal`, `computed`, `effect`), re-exported from `mantou-ui`. JavaScriptCore's JIT makes this fast, so there's no reason to move the reactive graph into native code as NSH did.
- **JSX:** Bun's built-in transform is React-style (`jsx()` calls), so it doesn't fit. A `Bun.plugin` runs `babel-preset-solid` with `generate: "universal"` and `moduleName` pointing at our renderer. The plugin runs in `dev`, in `build` and in the test runner. A faster Oxc-based compiler can come later, like NSH's.
- **Renderer:** `solid-js/universal`'s `createRenderer`, implemented over a **JS mirror tree**. Solid's renderer API needs synchronous `getParentNode`, `getFirstChild` and `getNextSibling`. Each mirror node holds an id, a parent, its children and its handlers. Every mutation updates the mirror and appends an op.

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
  - NSH frees nodes only through GC finalizers. We avoid that because the timing of JavaScriptCore's garbage collection is unpredictable, and native resources (GPU textures, text layouts) would linger.

## 8. Protocols

### 8.1 Ops (Worker → core)

One `ArrayBuffer` per commit. It holds a header, a section of newly interned strings, and the op stream as 32-bit words. `f32` values are written through a `Float32Array` view over the same buffer.

```
header:   magic u32 · version u16 · flags u16 · opCount u32 · stringsBytes u32
strings:  repeated { id u32 · byteLen u32 · utf8 bytes (padded to 4) }   // new interned strings only
ops:      repeated { opcode u16 · wordCount u16 · words… }
```

| Op | Operands | Meaning |
|---|---|---|
| `CREATE` | id, kind | New node (`View`, `Text`, `Span`, `Scroll`, `Image`, `Input`, `List`, `Window`…) |
| `TEXT` | id, strId | Text content of a text leaf or span |
| `INSERT` | parent, child, before (0 = append) | Insert, or move if the child is already attached |
| `REMOVE` | parent, child | Detach only |
| `RELEASE` | id | Free the node and its resources |
| `STYLE` | id, prop, value… | Set one style property (typed value; see below) |
| `STYLE_RESET` | id, prop | Back to the default |
| `PROP` | id, prop, value… | Non-style props: `src`, `placeholder`, `role`, `label`, `value`+`rev`, `disabled`… |
| `LISTEN` | id, eventMask | Which events this node has handlers for |
| `STYLE_DEF` | styleId, (prop, value…)* | Define a shared style (§8.4) |
| `STYLE_USE` | id, styleId (0 = none) | Apply a shared style; per-node `STYLE` ops override it |
| `COMMAND` | id, cmd, reqId, args… | `focus`, `blur`, `scrollTo`, `measure`, `animate`, `select`… |

**Value encodings:**
- `f32` (number)
- `u32` (enum)
- `color` (RGBA8 packed into a u32; wide gamut later)
- `length` (f32 + a unit: px, %, auto)
- `strId`
- short lists: a count followed by the items

Style and prop ids, and their types, are **generated from one schema** shared by the Rust decoder and the TS encoder and typings, so the two sides can't drift apart.

### 8.2 Events (core → Worker)
- The main thread appends event records to a buffer guarded by a mutex. It sets an atomic `wake_pending` flag, and only if that flag was clear does it call the threadsafe `wake` callback. That coalesces bursts into one wake.
- On wake, the Worker calls `mt_take_events()`, which swaps the buffers and clears the flag. It then dispatches every record. Any ops the handlers produce flush in the same turn's microtask.
- Record format: `type u16 · size u16 · target u32 · time f64 · payload…`

| Event | Payload |
|---|---|
| `PRESS`, `LONG_PRESS` | position; the core synthesises these from the pointer, keys and accessibility actions |
| `POINTER_DOWN/MOVE/UP/ENTER/LEAVE` | position, buttons, modifiers. Sent only to nodes listening for them |
| `KEY_DOWN/UP` | key, code, modifiers, repeat |
| `TEXT_CHANGE` | value strId, selection, `rev` |
| `FOCUS`, `BLUR` | — |
| `SCROLL` | offset (throttled; only if listened for) |
| `LAYOUT` | rect. For `onLayout` listeners and `measure` replies (`reqId`) |
| `WINDOW` | resized, moved, close-requested, focus changed, scale changed |
| `MENU`, `A11Y_ACTION`, `FILE_DROP`, `COMMAND_RESULT` | … |

**Propagation:** the core hit-tests and sends the target, plus the path of ancestors that have listeners. JS runs the capture and bubble phases. `stopPropagation` happens in JS.
**No synchronous `preventDefault`:** input is asynchronous, so the core's default actions (focus on press, scroll on wheel, editing keys) are controlled by props (`focusable`, `scrollEnabled`, `onKeyDown` with declared `keys` it consumes). This is a deliberate API constraint.

### 8.3 Text input
- **The core owns editing:** caret, selection, IME composition, undo, clipboard and word movement, so typing never waits for JS.
- **Decided (Q2): two modes, like the DOM. Typing never waits for JS in either.**
  - `defaultValue` makes the input **uncontrolled**: the core holds the text, and `onChange` reports it.
  - `value` + `onChange` makes it **controlled**: the core applies keystrokes at once and reports `TEXT_CHANGE(value, rev)`. The `value` prop JS sends back carries the `rev` it answers, and the core ignores values whose `rev` is stale. A `value` that differs from what the user typed (uppercasing, say) replaces the text, and the caret is kept by its offset from the end.
- **Constraints are declarative, not synchronous filters:** `maxLength`, `allow` (a regex over characters, checked natively), `inputMode`, `autoCapitalize`, `secure`. These cover what `beforeinput` filtering is usually for, without a synchronous round trip through JS.

### 8.4 Styles
- **Decided (Q4): v1 uses typed style objects only** (`style={{…}}`). They cover flexbox and grid (Taffy), box properties (background, border with per-side widths, radii, shadow, opacity, transform, overflow/clip) and text (font family, size, weight, line height, color, alignment, decoration). TypeScript checks every property.
- **Shared styles on the wire from day one:**
  - The JSX plugin hoists static style objects. The runtime sends each one once as `STYLE_DEF(styleId, props…)`, and nodes reference it with `STYLE_USE(id, styleId)`.
  - Dynamic values still go through per-property `STYLE` ops, and they override the shared style.
  - A list of 1,000 rows sharing one style therefore costs one definition plus 1,000 four-byte references.
- **Later (after M6):** an optional build-time Tailwind subset that compiles `class="…"` into the same `STYLE_DEF`s, so the core never parses classes. It's worth adding for AI-generated UI, as NSH found, but not before theming and the base components settle.
- Units are logical pixels. The core rounds layout to device pixels at the window's scale factor.

### 8.5 Text
- parley lays text out on the Worker thread, inside `mt_commit` during layout. Measurements are cached by a hash of the layout-relevant content plus the width constraint; colour is excluded, so a colour change never triggers layout.
- swash rasterizes glyphs into a coverage atlas and a colour atlas. Following MyGo, a glyph seen for the first time goes into a transient zone and moves to a lasting one once drawn again. If an atlas fills mid-frame, the core makes room and repaints rather than showing missing glyphs.
- **Decided (Q5): parley on every platform in v1, behind a `TextEngine` trait** (as NSH has).
  - **Why:** one implementation to build and debug. Layout is also identical on every OS when the fonts are the same: tests bundle a test font, so headless text and image snapshots taken on Linux CI hold everywhere.
  - **Cost:** text won't match each OS's own toolkit pixel for pixel, as MyGo's system text stacks do.
  - **Checkpoint after M3:** compare screenshots of parley text against native labels on each OS. If the difference is noticeable, add a Core Text backend first, since Mac users notice text rendering most. The trait keeps that change local to `mantou-text`.

## 9. Rendering

### 9.1 Frame pipeline
1. **Commit (Worker thread, inside `mt_commit`):** apply ops → mark dirty → incremental Taffy layout → text layout → rebuild the scene for dirty subtrees → publish `Arc<Scene>` → `EventLoopProxy` sends "scene ready" → winit `request_redraw`.
2. **Composite (main thread, on `RedrawRequested`):** take the latest scene, apply the native scroll offsets and the running compositor animations, build instance buffers, draw, present.
3. **Resize (main thread):** lock the tree, lay out at the new size (bounded wait), rebuild the scene and draw. JS is involved only if components read the window size.

### 9.2 The scene
- A flat list of operations in device pixels: rounded rect (fill, gradient, per-side border, dashes), shadow (outer and inset), glyph run, image, push/pop clip (rounded), and later effect and canvas.
- Layers: scroll containers and nodes with a running transform or opacity animation form a layer. Its transform is applied at composite time, so scrolling and these animations need no relayout and no scene rebuild.

### 9.3 Renderer (wgpu)
- One instanced quad per operation. An "uber" fragment shader computes the SDF for rounded rects, analytic blurred shadows (Evan Wallace's method), gradients, border dashes, atlas coverage and the innermost rounded clip. Outer clips become scissor rects. This follows MyGo's `internal/gpu`.
- Batches share a scissor rect and a texture. Operations completely hidden by a later opaque fill are dropped.
- Frames are drawn only when asked for: something changed, a scroll or animation is running, or the window resized. With nothing pending, the display link stays paused.
- **Later:** damage tracking, a CPU fallback (tiny-skia) for machines without a usable GPU, a canvas API.

### 9.4 Scrolling and animation
- **Scrolling** belongs to the core: wheel and trackpad input, momentum (taken from the OS where it provides it), rubber-banding and scrollbars. JS receives throttled `SCROLL` events only if it listens for them.
- **Virtualized lists:** the core asks JS for rows by index as they come into view (`LIST_NEED(rows)`), and JS answers with ops. Rows that leave the view are recycled, with new item signals bound to them.
- **Animations:**
  - Declarative transitions on style props (`transition={{ opacity: 200 }}`) and an `animate()` command run in the core, with timing curves and springs.
  - Animations of compositor props (transform, opacity, colour) run on the main thread without relayout.
  - Animations of layout props relayout once per frame under the lock.

## 10. Input, focus, accessibility, platform services

- **Hit-testing and focus:** the core, on the main thread, against the last layout. Tab order comes from tree order plus `tabIndex`. Focus rings are drawn by the core.
- **IME:** winit's `Ime` events plus `set_ime_cursor_area`, from the caret of the focused input. The composition is drawn inline.
- **Accessibility:** the core builds an AccessKit tree from the shadow tree: roles and labels from props, values, ranges and states. It updates it after each commit when assistive technology is active. Actions are performed natively where possible (focus, scroll, set a value); otherwise they arrive as `A11Y_ACTION` events.
- **Platform services:** menus (app, context, tray), file dialogs, the clipboard, notifications, multiple windows and DPI changes, exposed as async TS functions that go through `COMMAND` / `COMMAND_RESULT`.

## 11. FFI conventions and Bun-specific rules

- **Pass scalars, pointers and lengths only.** Encode everything else into buffers.
- **Keep the call count low:** one call per commit and one per batch of events. Never one call per node or style.
- **Pointer lifetimes:**
  - Op buffers belong to JS and must stay alive for the length of the `mt_commit` call. The core copies anything it keeps.
  - The pointer returned by `mt_take_events` is valid until the next call.
- **Callbacks:** only the `wake` callback crosses from native to JS, and it is `threadsafe: true`. No other native-to-JS callbacks exist.
- **Version checks:** `mt_abi_version()` is checked at startup, and the op format carries `version`. A mismatch is a fatal error with a clear message.
- **Experimental APIs:** Bun marks `bun:ffi` and `Worker` experimental. Pin the Bun version per release and run CI on all three OSes from M0.

## 12. Testing

Testing covers two things:
1. **Mantou itself.** Every layer, from the op decoder to signed packages.
2. **Apps built with it.** The test API is part of the product. Mantou uses it to test itself, so it gets exercised constantly.

### 12.1 Principles

These are adopted from MyGo's "Waiting in tests" rules and NSH's `nsh test`.

- **Never sleep and then check.** Wait for the condition or event itself (`waitFor`). A global guard of about a minute only turns a hang into a failure that names what never happened. Timeouts are never tuned to make a test pass.
- **Time is controlled.** Headless apps run on a manual clock that moves only when the test says so (`app.clock.advance(ms)`). Animations, debounces, double-clicks, long presses and Mantou's `after()` timers all read it. No test depends on how fast the machine is.
  - **JS side:** `open()` turns on `bun:test`'s fake timers. Verified in Bun 1.4.4: they cover `setTimeout`, `setInterval`, `Date` and `performance.now`.
  - **Native side:** the core's clock is advanced through `mt_test_step`.
  - `app.clock.advance(ms)` moves both together, so JS timers and native animations stay in step. Bun has no `requestAnimationFrame`, so Mantou's animation-frame API reads the core's clock.
- **Every step settles.** Each action (`press`, `type`, `scroll`, …) runs until the app is idle at the current clock time: no queued ops, events or due timers, and no request in flight. NSH's `EngineControl::flush` works the same way.
- **Measure counts in tests, time in benchmarks.** Tests assert ops per update, FFI calls per turn, layouts, text measurements, frames drawn and wake-ups. Wall-clock time is measured only by benchmarks, which are tracked over time (§12.7).
- **Query the way users and assistive technology see the app.** Find elements by role and accessible name, or by visible text, before falling back to test ids. A control a test can't find by role probably can't be found by a screen reader either.
- **Use one test API in two modes.** The same test file runs headless (fast, in-process, the default) or against a real window (`--target window`), through one driver interface. NSH does the same with its `Headless` and `Remote` drivers.

### 12.2 Headless mode (core support)

The core runs without winit or a GPU surface. The tree, layout, text, scene building, hit-testing, focus, scrolling, animation and the AccessKit tree are all platform-independent (§6.2), so only the platform layer is swapped out.

This makes the core **multi-instance**: every ABI function takes an instance handle, and there are no global singletons. That's NSH's rule, and it also enables embedding several surfaces in one app. §6.3 changes accordingly: `mt_run` creates the app instance, and the functions below create headless ones.

```c
uint64_t mt_headless_new(const uint8_t* config, uint32_t len);          // size, scale, color scheme, locale, fonts
void     mt_headless_free(uint64_t inst);
void     mt_test_input(uint64_t inst, const uint8_t* ev, uint32_t len);   // synthetic pointer/key/text/IME/wheel/a11y action
uint32_t mt_test_step(uint64_t inst, double advance_ms);                // advance clock, run animations/scroll/layout; returns idle flags
uint32_t mt_test_query(uint64_t inst, const uint8_t* q, uint32_t len, uint8_t* out, uint32_t cap); // a11y-tree queries
uint32_t mt_test_capture(uint64_t inst, uint8_t* rgba, uint32_t cap);   // offscreen render (wgpu, software adapter OK)
uint32_t mt_test_scene(uint64_t inst, uint8_t* out, uint32_t cap);      // text dump of the scene, for snapshots
uint32_t mt_test_stats(uint64_t inst, uint8_t* out, uint32_t cap);      // counters: ops, layouts, measures, frames, wakes
```

**No Worker in headless mode.** There's no native event loop to own the main thread, so the app runs on the test's own thread. `mt_commit` is synchronous, and events are collected with `mt_take_events` right after each `mt_test_input` and `mt_test_step`. Tests are therefore deterministic and single-threaded.

The real threading model is covered by the window-mode tests (§12.5).

### 12.3 The app test API (`mantou-ui/test`)

It's built on **`bun:test`**: Jest-compatible, with `describe`, hooks, `expect.extend`, snapshots and `--coverage` included. NSH had to write its own test runner, matchers and value equality in Rust; we get all of that from Bun.

```tsx
import { test, expect } from "bun:test";
import { open } from "mantou-ui/test";
import { App } from "./App";

test("adds a todo", async () => {
  const app = await open(<App />, {
    size: [800, 600], scale: 2, colorScheme: "dark", locale: "en-US",
    fetch: { "GET https://api.test/quote": { json: { text: "Hi" } } },   // stubbed; unmatched requests fail the test
    storage: { todos: '["Walk"]' },
  });

  await app.waitFor({ text: "Hi" });
  await app.type({ role: "textbox", name: "What to do?" }, "Buy milk\n");
  await app.press({ role: "button", name: "Add" });

  expect(app.texts()).toContain("2 left");
  expect(app.get({ role: "textbox", name: "What to do?" }).value).toBe("");
  expect(app.lastStep.ops).toBeLessThanOrEqual(6);        // granularity check
  expect(await app.capture()).toMatchImage("todo-added");   // custom matcher, tolerance per pixel
});
```

| Area | API |
|---|---|
| Open | `open(<Component/>)` or `open("./App.tsx")`; options: size, scale, colour scheme, locale, reduced motion, platform to emulate (`"macos"` key bindings etc.), fonts, `fetch` routes, storage |
| Query | `get(q)`, `getAll(q)`, `find(q)`, `shows(q)`, `texts()`, `focused()`. `q` = `{ role, name }` \| `{ text }` \| `{ label }` \| `{ testId }` |
| Act | `press`, `longPress`, `hover`, `type` (text + `\n`), `key("Mod+S")`, `compose` (IME: marked text, then commit), `scroll`, `drag`, `dropFiles`, `resize`, `setColorScheme`, `a11yAction` |
| Wait / time | `waitFor(q \| fn)`; `clock.advance(ms)`; `clock.runAll()` (until no timers or animations are pending) |
| Inspect | `capture()` → RGBA, `scene()` → text dump, `a11yTree()`, `lastStep` / `stats()` (ops, layouts, measures, frames), `requests()` (stubbed fetches made) |
| Matchers | `toMatchImage(name, { maxDiff })`, `toHaveRole`, `toBeFocused`, `toBeVisible`; plain values use Bun's `toEqual`/`toMatchSnapshot` |

**Network:** the app runs in the test process, so `fetch` routes swap `globalThis.fetch` for the length of the test and restore it afterwards. Unmatched requests fail with a clear error unless `fetch: "live"` is given.

**Failure output:** the step that failed, the query, the texts on screen and a compact accessibility tree. With `--trace`, also every step's ops and commit timings.

**`mantou test <entry>` without a test file:** runs the app headless and replays steps from stdin, as NSH's `nsh test App.tsx` does. It's for quick checks and bug reports.

### 12.4 Testing Mantou, layer by layer

| Layer | Tool | What it checks |
|---|---|---|
| **Op schema and codegen** | `cargo test` + `bun test` | TS encoder → Rust decoder round trip for every op and value type. The generated code matches committed golden files. Version and ABI mismatches fail with the intended message |
| **Op decoder** | `cargo fuzz` | Malformed or truncated buffers never panic or read out of bounds; they return errors. Random *valid* op sequences keep tree invariants: one parent per child, no cycles, released ids never reused before `RELEASE` |
| **Tree and layout** | `cargo test`, property tests (`proptest`) | Incremental layout equals layout from scratch after random mutations, frame after frame (MyGo's `TestLayoutCacheMatches`). Rounding to device pixels at scales 1, 1.25, 1.5, 2 and 2.625. Taffy pitfalls from NSH (`pitfalls.md`) as regression tests |
| **Text** | `cargo test` | Measure cache: a colour change means no relayout and a width change hits the cache. Bidi, wrapping, ellipsis, emoji, font fallback. Caret and selection geometry. Atlas full mid-frame → room is made and the frame repainted, with no missing glyphs |
| **Scene builder** | `cargo test` + text snapshots | Scene dumps for reference trees. Clipping, layering of scroll containers and animations, operations hidden under an opaque fill dropped |
| **Input and focus** | `cargo test` | Hit-testing with transforms and clips, tab order, pointer capture, press synthesis, wheel and momentum scrolling on the manual clock, text editing and the IME composition state machine |
| **Accessibility** | `cargo test` | AccessKit tree for reference trees: roles, names, values, states, actions, and updates after commits |
| **Renderer** | `cargo test` (offscreen wgpu) | Reference scenes (MyGo's `gputest.Scene` idea) drawn offscreen and compared with committed images within a per-pixel tolerance. Each backend has its own images where they legitimately differ. Once the CPU fallback exists, it becomes the oracle that GPU output is compared against, as MyGo does |
| **TS runtime** | `bun test` with a **mock core** that records ops | Op streams per primitive and component. Granularity: one signal update → expected op count. `<If>`/`<Each>` keep siblings and moves never re-insert. Nodes are released when their owner is disposed (live-node count returns to its baseline). Event dispatch: capture and bubble, `stopPropagation`. Text-input `rev` handling |
| **JSX plugin** | `bun test` | Compile output snapshots: static vs dynamic props, spreads, refs, components, and source maps pointing back at the TSX |
| **Full stack, headless** | `bun test` + `mantou-ui/test` | Every example app and the component gallery: behaviour, accessibility queries, image snapshots, op-count budgets |

### 12.5 Window mode: the real threading model and platform layer

The same test files run with `mantou test --target window`. Each `open` starts the app as a **separate process** with a real window. The test process drives it over a local socket through a test-only automation protocol, using the same `Driver` interface as headless mode (MyGo's `plugins/automation`, NSH's `Remote` driver). Steps settle the same way: the app reports idle.

On top of the shared app tests, a **platform suite** covers what headless mode can't:

- **Threading (the M0 claims, kept as regression tests):**
  - While the Worker runs a 2-second busy loop, a scripted scroll still advances frames. Asserted by count: the frames presented during the block are at least the expected number for the display's refresh rate, minus slack.
  - A live resize while the Worker has `fetch` and timers in flight: both complete, and the window presents frames at its new size.
  - Idle: over a 5-second window with nothing changing, **0 frames presented and 0 Worker wake-ups** (counters from `mt_test_stats`, not CPU percentages).
  - The bounded resize wait never exceeds its limit; this is a counter of waits that hit the limit.
- **Platform integration:** window lifecycle and close requests, multiple windows, DPI changes (where the CI runner can simulate them), menus and their actions, clipboard round trip, file drop, dialogs (driven through the automation protocol's dialog stubs).
- **IME:** the composition path is driven by synthetic IME events in the platform layer. The real input methods (macOS Japanese/Pinyin, Microsoft IME, ibus/fcitx) are covered by a **manual release checklist**, because CI can't drive them reliably. MyGo skips these tests while an input method is selected for the same reason.
- **Accessibility smoke tests:** read the window through each OS's own API (AX on macOS, UI Automation on Windows, AT-SPI on Linux) from a helper process. Check that a button's role and name arrive and that a press action reaches JS.

### 12.6 CI matrix

| Job | Runner | Runs |
|---|---|---|
| `core` | Linux, macOS, Windows | `cargo test`, `cargo clippy`; fuzzing nightly (time-boxed) |
| `runtime` | Linux | `bun test` (mock core, JSX plugin, schema round trip), `tsc --noEmit` on the typings and examples |
| `headless` | Linux, macOS, Windows | `mantou test` on the examples and gallery, with image snapshots. Software GPU adapters: Mesa (lavapipe/llvmpipe) on Linux, WARP on Windows; Metal on GitHub's `macos-14` Apple Silicon runners, where wgpu's own CI runs its GPU and image tests |
| `window` | Linux (Xvfb and a headless Wayland compositor), macOS, Windows | `mantou test --target window` + the platform suite (§12.5) |
| `package` | each OS | Build, sign (test certificates on PRs), launch the packaged app with `--self-test` (first frame drawn → exit 0), `codesign --verify` / `signtool verify` |
| `bun-canary` | Linux, macOS, Windows, nightly | All of the above against Bun's canary build, to catch `bun:ffi` and `Worker` regressions before they ship |
| `bench` | dedicated machines, main branch | §12.7, results stored and compared |

**Image comparison (decided, T2):**
- Pixels are compared pixelmatch-style: a colour-distance threshold (default 0.1), with anti-aliased edge pixels detected and ignored. The test fails if more pixels differ than `maxDiffPixels`, which defaults to 0; tests can override both values.
- Reference images are stored per backend and OS only where the backends really differ.
- References are updated locally only, with `mantou test --update-snapshots`. CI never writes them. A failed comparison uploads the actual image, the expected one and a diff image as CI artifacts, as wgpu's CI does.
- A bot command to accept changes can come later if updating by hand becomes tedious.

### 12.7 Benchmarks (tracked, not gating)

- **Commit:** creating 1,000 rows; updating one cell in 10,000 rows (time and ops).
- **Layout:** full and incremental layout of a 5,000-node tree.
- **Text:** measuring and laying out a 1 MB document; scrolling it.
- **Scroll:** frame time of a virtual list of 1,000,000 rows during a scripted fling.
- **Start-up:** process start → first frame presented (packaged app, cold and warm).
- **Memory:** idle footprint of the counter example; growth after 10,000 open/close cycles of a dialog, which should be none.
- **Input latency:** synthetic input → frame presented, measured by the core (MyGo has an input-latency harness that can serve as a model).

Regressions above a threshold open an issue automatically. They never fail PRs, because timings are noisy.

### 12.8 Test infrastructure per milestone

| Milestone | Testing work delivered with it |
|---|---|
| M0 | Window-mode harness skeleton; the threading and idle tests of §12.5 on all three OSes |
| M1 | Schema round-trip and golden tests, decoder fuzzing, mock core, headless instance + `mt_test_step`/`mt_test_stats`, op-count assertions |
| M2 | Offscreen reference-image tests and the `toMatchImage` matcher |
| M3 | Text tests, measure-cache counters |
| M4 | `mantou-ui/test` actions and queries, manual clock, window-mode driver |
| M5 | IME state-machine tests + the manual IME checklist |
| M7 | AccessKit tree tests + OS accessibility smoke tests |
| M8 | Package job, `--self-test`, `bun-canary` |

### 12.9 Testing decisions

- **T1 Clock — decided:** use `bun:test`'s fake timers for the JS side and drive the core's clock with `mt_test_step`, both behind `app.clock` (§12.1). Verified in Bun 1.4.4: `jest.useFakeTimers()` moves `setTimeout`, `setInterval`, `Date.now()` and `performance.now()`, and `runAllTimers` exists. Bun has no `requestAnimationFrame`; Mantou provides its own on the core's clock.
- **T2 Image comparison — decided:** pixelmatch-style comparison that ignores anti-aliasing, with `maxDiffPixels` defaulting to 0. References are updated locally only; CI uploads actual, expected and diff images (§12.6).
- **T3 macOS GPU in CI — decided:** use GitHub's `macos-14` Apple Silicon runners. wgpu's own CI (`gpu-test` job) runs its GPU and image-comparison tests on them, with WARP on Windows and Mesa on Linux, the same setup as ours. A dedicated Mac is needed only for benchmarks, because timings on virtual machines are noisy.

## 13. Milestones

| | Deliverable | Exit criteria |
|---|---|---|
| **M0** Threading spike | Bootstrap + Worker + winit window + wgpu clear colour + events round trip | Works on macOS, Windows and Linux. `fetch` and timers in the Worker keep working during live resize. Idle CPU ≈ 0% — **Linux ✅ (2026-11-03); macOS and Windows pending CI** |
| **M1** Tree and ops | Op encoder and decoder from a shared schema; shadow tree; Taffy; rects drawn | Counter example updates through ops; one FFI call per turn; headless instance + mock core in CI (§12.8) |
| **M2** Renderer | Rounded rects, borders, shadows, clips, images, HiDPI | Renderer reference-image tests pass on all three backends |
| **M3** Text | parley layout, atlases, spans, measure cache | Wrapping, bidi and emoji render; colour change triggers no relayout |
| **M4** Interaction | Hit-testing, press, focus, keyboard, native scrolling, Solid renderer + JSX plugin | Scrolling stays at the display's refresh rate while the Worker runs `while(true)` |
| **M5** Inputs | Text input with IME, selection, clipboard | CJK IME works on all three OSes |
| **M6** Components | Unstyled base components, virtual list, transitions | Gallery example |
| **M7** Platform and accessibility | Menus, dialogs, multiple windows, AccessKit | Basic VoiceOver and Narrator walkthroughs work |
| **M8** Ship | CLI `dev` (hot reload by restarting the Worker, keeping the windows; §17 Q7), `build`, `package`; signing and notarization | Signed `.app`/`.dmg`, installer and AppImage from CI; an edit shows in under 300 ms in the counter example |

## 14. Packaging and distribution

- `bun build --compile ./main.ts ./app-worker.ts` produces a single executable containing both the bootstrap and the Worker entry. Verified with Bun 1.4.4 on Linux: the Worker entry must be listed as an extra entry point, and `bun:ffi` works inside the compiled Worker.
- The native core: `dlopen` needs a real file. Ship it beside the binary inside the bundle, or embed it and extract it to a cache directory named by a content hash on first run.
- **macOS:**
  - `.app` bundle, plus a `.dmg`.
  - Code signing with the hardened runtime. JavaScriptCore's JIT requires the `com.apple.security.cs.allow-jit` entitlement.
  - Notarization.
- **Windows:** an installer (MSI or NSIS), signed with Authenticode.
- **Linux:** AppImage and `.deb`. Runtime dependencies are few: Vulkan or GL drivers, and the libraries winit needs (Wayland/X11, xkbcommon).
- **Size:** dominated by the Bun runtime. A minimal compiled bootstrap + Worker measured about 109 MB (104 MiB) on Linux x64 with Bun 1.4.4, before the native core. Track it from M0 onwards, and check whether compression in the installers (DMG, MSI or NSIS, AppImage) brings the download down substantially.

## 15. Alternatives considered

| Alternative | Why not (for now) |
|---|---|
| Native loop on the main thread, **pumped from a JS timer** | Idle CPU vs. input latency trade-off; Bun I/O stalls during waits |
| **Two processes** (native host + Bun process over shared memory) | More moving parts and IPC latency. **Kept as the fallback** if the Worker approach fails M0 on some OS |
| **Layout in TS** (Yoga WASM), display list per frame | Text measurement crosses FFI mid-layout; scrolling and resize would depend on the JS thread |
| **Pure TS over `bun:ffi`** to AppKit/Win32/GTK, with no Rust | No structs by value; verbose Objective-C and COM; much more FFI traffic; three backends |
| **Wrap OS widgets** | Three implementations per widget; looks and behaves differently per platform |
| **Native views per node** (NSH's approach) | Scroll physics and text come native, but there are three backends to maintain. The core stays backend-agnostic at the scene level so this could be added later |
| **Embed QuickJS** instead of using Bun (NSH's approach) | Would run on mobile, with a small binary, but loses the JIT, npm and Node APIs. Bun can't be embedded. If mobile becomes a requirement, revisit, or use NSH itself |
| **Immediate-mode rebuild per frame** (MyGo's approach) | Rebuilding the tree every frame in JS creates garbage-collection pressure; fine-grained signals avoid it |

## 16. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bun's main thread isn't usable as AppKit's main thread, or Worker + FFI is unstable on macOS or Windows | Medium | Test first in M0. Fall back to two processes |
| `bun:ffi` or Worker regressions between Bun versions | Medium | Pin the Bun version; ABI smoke tests in CI on each Bun upgrade |
| IME and text editing effort | High | Budget M5 generously; start from winit's IME support; test with real CJK input methods |
| Text quality perceived as "not native" | Medium | `TextEngine` trait; screenshot comparison checkpoint after M3; Core Text backend first if needed |
| GC timing makes the safety-net release unpredictable | Low | Deterministic release on owner disposal (§7.4) |
| Binary size (~109 MB for a compiled Bun app) and memory vs. Go or Rust frameworks | Certain | Document it; it's the price of Bun's ecosystem |

## 17. Decisions (formerly open questions)

1. **Q1 Name — resolved: Mantou.** The npm name `mantou` is held by an unrelated Bun project template (`bun create mantou-app`; last published 2025-02, ~135 downloads/month in Oct 2026). Use `mantou-ui` (free on npm and crates.io as of 2026-11-03), or ask the owner to transfer `mantou`. Still to check: a `@mantou` npm scope, the GitHub org, the domain, and trademarks.
2. **Q2 Text input — decided:** controlled (`value` + `onChange`, reconciled by `rev`) and uncontrolled (`defaultValue`) modes, with editing owned by the core in both, and declarative constraints instead of synchronous filters (§8.3). This matches what React and DOM developers expect without making typing wait for JS.
3. **Q3 Node release — decided:** deterministic release when the owning Solid scope is disposed, a `FinalizationRegistry` safety net, and a development-build warning when the safety net fires (§7.4). Native resources such as textures and text layouts shouldn't wait on JavaScriptCore's GC timing.
4. **Q4 Styling — decided:** typed style objects in v1, with shared `STYLE_DEF`/`STYLE_USE` on the wire from M1, and an optional build-time Tailwind subset after M6 that compiles into the same definitions (§8.4). Type checking and a small surface come first; classes later cost no change to the core.
5. **Q5 Text engine — decided:** parley everywhere behind a `TextEngine` trait, with a screenshot comparison against native labels after M3 and Core Text as the first native backend if needed (§8.5). One engine means one code path and text snapshots that hold on every OS.
6. **Q6 Reuse `nsh-core` — decided: no; borrow ideas, not the crate.** Checked at NSH @b13c8c2: `nsh-core` is about 149k lines of Rust.
   - It carries NSH's own reactive graph (we keep Solid in JS), a Tailwind parser, navigation, storage, WebSocket and tokio.
   - Its output is `MountItem`s for native views (`Create { kind: ViewKind }`, `Insert`…) rather than a scene for a GPU renderer.
   - It's at version 0.3, so its API is still moving.
   - Adopting it would mean adopting NSH's architecture. What we take instead, under Apache-2.0 with attribution where code is copied: Taffy's rounding fix, the measure-cache design, the `before`-anchored insert, and the pitfall list as regression tests.
7. **Q7 Hot reload — decided:** `mantou dev` restarts the Worker on save and keeps the windows open. The core clears the instance's tree but keeps windows, surfaces, GPU resources and atlases, so nothing flashes, and the new Worker rebuilds the UI.
   - State survives only if the app opts in, through `persist(key, signal)`, which stashes values in the core across restarts (development builds only).
   - Component-level hot module replacement (solid-refresh style) is deferred. A fresh Worker never leaves stale module state behind, and Bun starts a Worker in milliseconds.

## 18. References

- **MyGo**, `docs/architecture.md` §"Native UI" (line 2234 on): frame loop `ui/runtime.go` (`runFrame`); layout cache `ui/layoutcache.go`; paint `ui/paint.go`; scene `internal/scene/scene.go`; GPU renderers `internal/gpu/{metal,d3d11,gl}`; present and fallback `ui/window.go` (`present`).
- **NSH**, `docs/dev/architecture.md` (thread model, commit pipeline); `docs/dev/native-pipeline.md` (JSX compiler, renderer, ops, lists); `docs/dev/pitfalls.md` (Taffy rounding, re-insert, GC roots); `docs/dev/macos.md` (bounded resize wait).
- **Solid** `solid-js/universal`, `babel-preset-solid` (`generate: "universal"`).
- **Rust crates:** winit, wgpu, taffy, parley, fontique, swash, accesskit, muda, rfd, arboard.

---

## Appendix A — Threading spike (validated on Linux, Bun 1.4.4)

```c
// native.c — a native thread that calls back into JS three times
#include <pthread.h>
#include <unistd.h>
typedef void (*cb_t)(int);
static cb_t cb;
static void *run(void *a) { for (int i = 1; i <= 3; i++) { usleep(300000); cb(i); } return 0; }
void start(cb_t f) { cb = f; pthread_t t; pthread_create(&t, 0, run, 0); pthread_detach(t); }
```

```ts
// main.ts — the main thread blocks in native code, as [NSApp run] would
import { dlopen, FFIType } from "bun:ffi";
const libc = dlopen("libc.so.6", { sleep: { args: [FFIType.u32], returns: FFIType.u32 } });
new Worker(new URL("./worker.ts", import.meta.url).href);
await Bun.sleep(50);
libc.symbols.sleep(2);
```

```ts
// worker.ts — timers, async I/O and native wake-ups keep working
import { dlopen, JSCallback, FFIType } from "bun:ffi";
const lib = dlopen(import.meta.dir + "/libnative.so", { start: { args: [FFIType.function], returns: FFIType.void } });
const cb = new JSCallback((n: number) => console.log("native event", n),
  { args: ["i32"], returns: "void", threadsafe: true });
lib.symbols.start(cb.ptr);
setInterval(() => console.log("tick"), 100);
console.log((await Bun.file(import.meta.path).text()).length);
```

Observed while the main thread was blocked for 2 s: the 100 ms timer kept time, the file read completed, and the native thread's three callbacks ran at 300 ms intervals.
