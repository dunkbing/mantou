---
title: Menus, dialogs and the clipboard
description: Native dialogs, the app and context menus, the clipboard, and accessibility.
---

All of these are `async`. Dialogs and menus resolve to `null` when cancelled.

## Dialogs

```tsx
import { openFile, saveFile, message } from "mantou-ui";

const paths = await openFile({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg"] }] });
const path = await saveFile({ name: "notes.txt" });
const button = await message({ title: "Delete?", message: "This can't be undone.", level: "warning", buttons: ["Delete", "Cancel"] }); // the index chosen
```

## Menus

```tsx
import { setMenu, onMenu, showMenu } from "mantou-ui";

await setMenu([{ label: "File", items: [{ id: "new", label: "New", accelerator: "cmd+n" }, { role: "quit" }] }]);
onMenu((id) => id === "new" && newFile());

// A context menu at the pointer:
<View onContextMenu={async (e) => {
  const id = await showMenu([{ id: "reply", label: "Reply" }, { id: "del", label: "Delete" }], { x: e.x, y: e.y });
}} />
```

On a Mac the app menu has Edit, Window and Quit already; Cmd+Q, Cmd+W and copy/paste work without setup.

## Clipboard

```tsx
import { clipboard } from "mantou-ui";

await clipboard.writeText(url);
const text = await clipboard.readText(); // string | null
```

## The window

Open it the way you want with `run`:

```tsx
run(App, { title: "Notes", width: 900, height: 600, frameless: true, alwaysOnTop: false, x: 120, y: 80 });
```

(`fullscreen`, `maximized`, `resizable`, `minWidth`… too.) Change it later with `win`:

```tsx
import { win } from "mantou-ui";

await win.setFullscreen(true);
await win.setMaximized(true);
win.minimize();
win.setAlwaysOnTop(true);
win.setPosition(120, 80);                         // logical px, outer top left
win.onState((s) => save(s));                      // { focused, minimized, maximized, fullscreen, x, y }

// A custom title bar: a frameless window with a view that moves it.
<View dragRegion style={{ height: 32 }}>…</View>
```

Each call answers with the window's state right after asking; the OS may take a moment (full screen animates), so use `onState` for the result. A window without a title bar or a resizable frame doesn't report `maximized`. A transparent window and the window icon aren't supported yet.

## Accessibility

Screen readers (VoiceOver, Narrator, Orca) see a tree built from your views. Text is a label, an `Input` a text field, and a view with `onPress` a button. Add the rest with props:

```tsx
<View role="checkbox" checked={done()} label="Buy milk" onPress={toggle} />
<View role="heading">…</View>
<View accessHidden>decoration</View>
```

Roles: `button`, `checkbox`, `switch`, `radio`, `link`, `heading`, `list`, `listItem`, `dialog`, `tab`, `tabList`, `menu`, `menuItem`, `image`, `group`, `status`, `alert`, `none`. Also `selected`, `disabled`.
