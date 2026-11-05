---
title: Menus and native dialogs
description: "File dialogs, message boxes, the app menu and context menus as async functions, with test answers in headless instances."
---

[#21](https://github.com/dunkbing/mantou/issues/21). Platform services are async functions from `mantou-ui`. Each sends a JSON request through `mt_service`; the core runs it on the main thread and answers with a `SERVICE_RESULT` event, which resolves the promise (`null` when the user cancels; a rejection when no dialog can be shown, see below). Chosen app-menu items arrive as `MENU` events.

```tsx
import { clipboard, openFile, saveFile, message, showMenu, setMenu, onMenu } from "mantou-ui";

const paths = await openFile({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg"] }] }); // string[] | null
const path = await saveFile({ name: "notes.txt" });                                                          // string | null
const button = await message({ message: "Delete this message?", level: "warning", buttons: ["Delete", "Cancel"] }); // index | null
const id = await showMenu([{ id: "reply", label: "Reply" }, { separator: true }, { role: "copy" }], { x, y }); // string | null

await clipboard.writeText(url);        // the system clipboard
const text = await clipboard.readText(); // string | null

setMenu([{ label: "File", items: [{ id: "open", label: "Open…", accelerator: "cmd+o" }, { separator: true }, { role: "quit" }] }]);
onMenu((id) => { if (id === "open") { /* … */ } });
```

Dialogs are native through `rfd`, menus through `muda` (macOS so far). A dialog is modal: the window stops drawing while it is open. On macOS the window starts with the standard App (About, Hide, Quit), Edit and Window menus; Quit asks the window to close, like its close button, so the app can veto it.

The clipboard is text only for now (images are not done) and is answered on the calling thread, so it works the same in a headless instance (a private in-memory clipboard).

## In tests

A headless instance has no UI: it answers from a queue, one answer per request, and cancels when the queue is empty.

```tsx
h.answer(["/tmp/a.png"]);            // the next request resolves to this
const p = openFile(); h.step(); await p;
h.lastService();                      // the request the core got, parsed
h.chooseMenu("open");                 // the user picks an app-menu item
```

`tests/platform.test.tsx` covers the round trip, cancelling, answers in order, an answer larger than the event buffer and menu events.

## Status

| | |
|---|---|
| Headless API and tests | Done (macOS). |
| App menu (`muda`) on macOS: the default menus, Cmd+Q, the Edit shortcuts | Checked in a window (below). |
| File dialogs, message boxes (`rfd`), `setMenu`, `onMenu` and `showMenu` on macOS | **Written, not yet run in a window.** Checklist below. |
| Windows and Linux app menu and context menus | Not started: they answer as cancelled. File dialogs and message boxes are written for every platform, but only the macOS build has been compiled. |

## macOS checklist

Checked on an Apple M4 by posting real key events to the running to-do example and reading the menu bar and the field through the accessibility API:

- [x] The default menus appear: App, Edit and Window, with Undo, Redo, Cut, Copy, Paste, Select All and their shortcuts. (Cmd+H and Cmd+M not tried.)
- [x] Cmd+Q sends `closeRequested` and the app exits.
- [x] Cmd+A, Cmd+C, Cmd+X, Cmd+V, Cmd+Z and Cmd+Shift+Z work in an `<Input>` with the Edit menu installed.
- [ ] `setMenu` replaces the menus; `onMenu` hears the chosen item and its accelerator.
- [ ] `showMenu` at the pointer resolves to the chosen id, and to `null` on Escape.
- [ ] `openFile` (one, several, folders, filters), `saveFile` and `message` (one, two and three buttons) open over the app and resolve correctly.

### A bug the check found

The first version used `muda`'s predefined Edit items (`copy:`, `paste:`…). Nothing in the window's view answers those selectors, and the menu still consumed Cmd+C before the input saw it: with the menu installed Cmd+A, Cmd+C and Cmd+X did nothing, and without it they worked. The Edit items (the roles `undo`, `redo`, `cut`, `copy`, `paste`, `selectAll`) are now ordinary items that press the same keys in the core, so there is one editing path and the menu items and shortcuts both work.

## Displays and window state

[#70](https://github.com/dunkbing/mantou/issues/70), [#67](https://github.com/dunkbing/mantou/issues/67). `monitors()` is a `monitors` service answered from winit's monitor list; `restoreState` is TypeScript (`runtime/winstate.ts`) over `win.state()`, `onResize`, `onState` and `paths.config`. The core drops an opening position that has no display under the window's top edge.

| What | Where it's tested |
|---|---|
| `monitors()` and `win.monitor()` from the core's answer | `tests/winstate.test.tsx` |
| Saved state replaces `run`'s options; other windows' entries are kept; a broken file is ignored | `tests/winstate.test.tsx` |
| Maximized keeps the normal box; minimized saves nothing; a resize saves a moment later | `tests/winstate.test.tsx` |
| Real displays listed, one current; a window opened at (-20000, -20000) lands on a display | self-test, check 14 |
| Move and resize, close, launch again: same place and size | by hand under Xvfb |

## When no dialog can be shown

[#28](https://github.com/dunkbing/mantou/issues/28). On Linux, rfd asks the desktop portal over D-Bus, then runs zenity, for file dialogs, and runs zenity for message boxes; with neither, it answers as if the person cancelled. The core checks first (`dialogs.rs`): zenity on `PATH`, or a session bus, the portal's D-Bus service and a portal backend whose interfaces include the file chooser (or Flatpak). When the check fails, the request answers `{ unavailable }` and the promise rejects; `dialogsAvailable()` asks the same check. Zenity's cancel (an empty list) answers `null`, like a cancel elsewhere.

| What | Where it's tested |
|---|---|
| The check: nothing, zenity, a portal (from `DBUS_SESSION_BUS_ADDRESS` or `XDG_RUNTIME_DIR`), no bus, no service, no file chooser, `XDG_DATA_DIRS`, Flatpak | `dialogs.rs` unit tests (`cargo test --release -p mantou-ffi --lib`) |
| A rejection names what to install; `[]` is `null`; `dialogsAvailable()` | `tests/platform.test.tsx` |
| In a window under Xvfb: nothing installed rejects at once (it answered `null` after 15 ms before); a stand-in zenity that picks a file, and one that cancels | by hand |
