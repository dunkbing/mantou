---
title: Menus and native dialogs
description: "File dialogs, message boxes, the app menu and context menus as async functions, with test answers in headless instances."
---

[#21](https://github.com/dunkbing/mantou/issues/21). Platform services are async functions from `mantou-ui`. Each sends a JSON request through `mt_service`; the core runs it on the main thread and answers with a `SERVICE_RESULT` event, which resolves the promise (`null` when the user cancels). Chosen app-menu items arrive as `MENU` events.

```tsx
import { openFile, saveFile, message, showMenu, setMenu, onMenu } from "mantou-ui";

const paths = await openFile({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg"] }] }); // string[] | null
const path = await saveFile({ name: "notes.txt" });                                                          // string | null
const button = await message({ message: "Delete this message?", level: "warning", buttons: ["Delete", "Cancel"] }); // index | null
const id = await showMenu([{ id: "reply", label: "Reply" }, { separator: true }, { role: "copy" }], { x, y }); // string | null

setMenu([{ label: "File", items: [{ id: "open", label: "Open…", accelerator: "cmd+o" }, { separator: true }, { role: "quit" }] }]);
onMenu((id) => { if (id === "open") { /* … */ } });
```

Dialogs are native through `rfd`, menus through `muda` (macOS so far). A dialog is modal: the window stops drawing while it is open. On macOS the window starts with the standard App (About, Hide, Quit), Edit and Window menus; Quit asks the window to close, like its close button, so the app can veto it.

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
| File dialogs, message boxes (`rfd`), app menu and context menu (`muda`) on macOS | **Written, not yet run in a window** (the Mac's screen was locked). Checklist below. |
| Windows and Linux app menu and context menus | Not started: they answer as cancelled. File dialogs and message boxes are written for every platform, but only the macOS build has been compiled. |

## macOS checklist

To tick off on a Mac with an unlocked screen:

- [ ] The default menus appear: App, Edit, Window; Cmd+H hides, Cmd+M minimizes.
- [ ] Cmd+Q and the App menu's Quit send `closeRequested` (the counter exits).
- [ ] **Cmd+C / Cmd+V / Cmd+A / Cmd+Z in an `<Input>` still reach the core's editor** with the Edit menu installed. The Edit items have no responder in the window's view, so AppKit should leave their key equivalents alone; if it doesn't, the shortcuts are swallowed and this is a bug.
- [ ] `setMenu` replaces the menus; `onMenu` hears the chosen item and its accelerator.
- [ ] `showMenu` at the pointer resolves to the chosen id, and to `null` on Escape.
- [ ] `openFile` (one, several, folders, filters), `saveFile` and `message` (one, two and three buttons) open over the app and resolve correctly.
