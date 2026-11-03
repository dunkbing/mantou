---
title: "The native core"
description: "The Rust core: its crates, code layout and C ABI."
---

## 6. The native core (Rust)

### 6.1 Crates

| Concern | Crate | Notes |
|---|---|---|
| Windows, input, IME, event loop | `winit` | `run_app` on the main thread; `EventLoopProxy` for wake-ups from other threads |
| GPU | `wgpu` | Metal / D3D12 / Vulkan, with GL as a fallback; WGSL shaders |
| Layout | `taffy` | flexbox, grid, block. Do our own rounding to device pixels |
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
`mantou-tree`, `mantou-text` and `mantou-scene` have no platform dependencies, so they can be tested headless ([§12](/design/testing/#12-testing)).

**Status:** `mantou-ffi`, `mantou-tree` and `mantou-render` exist. For now the scene types live in `mantou-tree`, and the winit code in `mantou-ffi`; `mantou-scene`, `mantou-text` and `mantou-platform` split out when text and platform services arrive. The C ABI is at version 3: every per-UI function takes an instance handle, and headless instances exist for tests ([§12.2](/design/testing/#122-headless-mode-core-support)).

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

**Revision planned (see [§12.2](/design/testing/#122-headless-mode-core-support)):** the core becomes multi-instance. Every function will take an instance handle: `mt_run` creates the app instance, and `mt_headless_new` creates headless instances for tests. The signatures above leave the handle out for brevity.
