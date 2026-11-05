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

## Notifications, links, tray and badge

```tsx
import { notify, openExternal, reveal, setBadge, createTray, onMenu } from "mantou-ui";

await notify({ title: "New mail", body: subject });   // true once it has been sent to the system
await openExternal("https://example.com");             // the default browser (or app, for a file)
await reveal("/Users/me/report.pdf");                  // show it in Finder / Explorer / the file manager
await setBadge(unread);                                 // the dock icon's count (macOS); 0 or null clears it

await createTray({ icon: "icon.png", tooltip: "My app", menu: [{ id: "open", label: "Open" }, { role: "quit" }] });
onMenu((id) => id === "open" && show());                // tray items arrive here, like the app menu's
```

`setBadge` and `createTray` work on macOS only for now (they resolve `false` elsewhere). A notification can't tell you it was clicked yet. Notifications from a program that isn't an app bundle show up under another name on macOS; `mantou package` apps use their own.

## One copy, and what it's opened with

```tsx
import { singleInstance, onOpen, run } from "mantou-ui";

if (!(await singleInstance((args) => console.log("launched again with", args)))) process.exit(0);
onOpen(({ url, file }) => (url ? route(url) : open(file!)));
run(App);
```

- **`singleInstance(onLaunch?)`** resolves `true` for the first copy and `false` for a later one, which has handed its arguments to the first (that window is focused) and should exit. Call it before `run`.
- **`onOpen`** hears the URLs (`scheme://…`, `mailto:`) and existing files among the launch arguments, both this copy's own and those of later launches.
- The copies talk over a local socket with a token kept in `paths.temp`.
- Arguments only: macOS "Open with" and URL-scheme launches arrive as system events, not arguments, and aren't delivered yet ([#66](https://github.com/dunkbing/mantou/issues/66)).

## Launch at login

```tsx
import { launchAtLogin } from "mantou-ui";

await launchAtLogin.set(true);       // start this app when the user logs in
const on = await launchAtLogin.get();
```

It writes a LaunchAgent (macOS), an autostart entry (Linux) or a `Run` registry value (Windows) that starts the command running now, so turn it on from the installed app, not from `bun run`.

## Where to keep files

```tsx
import { paths } from "mantou-ui";

await Bun.write(`${paths.config}/settings.json`, JSON.stringify(settings));
// paths.data (databases, documents), paths.cache (can be deleted), paths.temp
```

Each is the user's folder for the app (`~/Library/Application Support/<app>` on macOS, `%APPDATA%` or `%LOCALAPPDATA%` on Windows, XDG folders on Linux), created when you read it. The app's name is the `name` in the package.json in the working directory, or `MANTOU_APP`, or `paths.setApp("Notes")`.

For tokens and passwords use Bun's `Bun.secrets` (the system's Keychain, Credential Manager or libsecret) instead of a file:

```tsx
await Bun.secrets.set({ service: "my-app", name: "imap-token", value: token });
const token = await Bun.secrets.get({ service: "my-app", name: "imap-token" }); // null when missing
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
win.close();                                      // like the close button: the app gets closeRequested
```

### Keep the traffic lights (macOS)

`frameless` removes the system's buttons too. To draw your own header but keep them, ask for an overlay title bar: the content runs to the top edge and the buttons float over it. Close, minimize, zoom, full screen and snapping keep working.

```tsx
run(App, { titleBar: "overlay" });                // "native" (default) or "overlay"

function Header() {
  const { top, left } = win.safeArea;             // { top: 28, left: 72 } on macOS; zeros elsewhere
  return <View dragRegion style={{ height: top, paddingLeft: left }}>…</View>;
}
```

On Windows and Linux `"overlay"` is the native title bar for now.

Each call answers with the window's state right after asking; the OS may take a moment (full screen animates), so use `onState` for the result. A window without a title bar or a resizable frame doesn't report `maximized`. A transparent window and the window icon aren't supported yet.

### Remember where it was

```tsx
run(App, { title: "Mail", width: 900, height: 600, restoreState: true });
openWindow(Compose, { restoreState: "compose" });  // each window its own entry
```

The window opens where, how big and how it was when it last closed (maximized and full screen too; minimized isn't kept), instead of the size and position given. With nothing saved yet, those apply. The state is saved in `window-state.json` in `paths.config` a moment after each change, and when the window closes; while it's maximized, the size it goes back to is kept. If the saved position is on no display any more (a monitor was unplugged), the system places the window. That check applies to any `x`, `y`: a window has to have its top edge on a display.

### Displays

```tsx
import { monitors, win } from "mantou-ui";

const screens = await monitors();  // [{ name, x, y, width, height, scale, refreshRate, primary, current }]
const here = await win.monitor();  // the one the window is on
openWindow(Viewer, { x: screens[1].x + 40, y: screens[1].y + 40 });
```

Positions and sizes are logical px, the coordinates windows are placed with. On macOS that's exact with any mix of displays; on Windows and Linux, displays with different scales can be off by their scale's difference. There's no event when displays change yet, and no global cursor position (winit has neither); a headless instance answers what its test queued (`h.answer([...])`).

## More windows

```tsx
import { openWindow } from "mantou-ui";

const composer = openWindow(() => <Composer draft={draft} />, { title: "New message", width: 560, height: 420 });
composer.onClose(() => (draft.dirty ? confirmDiscard() : undefined)); // return false to keep it open
composer.focus();
composer.close();
```

- **Options:** `openWindow(app, options)` opens another window after the app's own is up (from a handler or an effect, not before `run()`). It takes `run()`'s window options (`title`, `width`, `height`, limits, `frameless`, `alwaysOnTop`, `x`, `y`…).
- **What you get back:** a handle with `close()`, `focus()`, `setTitle()`, `onClose()`, `closed` and the window's own `ui`.
- **Signals:** each window has its own tree, but the same Worker runs them all, so a signal read in two windows updates both.
- **Closing:** the close button (or Cmd/Ctrl+W) closes the window, unless an `onClose` handler returns `false`. Closing the app's first window quits the app, as before, and closes the others with it.
- **`mantou dev`:** a reload closes the other windows too; the app opens them again.

## Errors and crash reports

An error the app doesn't catch (thrown in a handler, an effect or a timer, or a promise rejected with nobody waiting on it) goes to `onError`:

```tsx
import { onError } from "mantou-ui";

onError((e) => {
  // e.kind: "error" | "rejection" | "core"; e.message; e.stack; e.report (a file, when one was written)
  showToast(`Something went wrong: ${e.message}`);
  return true; // handled: the app runs on
});
```

When no handler returns `true`, the app writes a report and quits (exit code 70), as it does with no handler at all. The report goes in `crashes` in the app's data folder (`paths.data`; or `MANTOU_CRASH_DIR`), named `app-<time>-<pid>.txt`: the message, the stack, Bun's version, the OS.

A panic in the native core writes `core-<time>-<pid>.txt` there too, with a backtrace. When the core recovers from it (the call that panicked is dropped and the app runs on), `onError` hears it as `kind: "core"`, with `e.report`; returning `true` changes nothing then. Under `mantou dev`, errors show in the window instead, until the next save. The folder follows the app's name, so call `paths.setApp` before `run` if you use it.

## Accessibility

Screen readers (VoiceOver, Narrator, Orca) see a tree built from your views. Text is a label, an `Input` a text field, and a view with `onPress` a button. Add the rest with props:

```tsx
<View role="checkbox" checked={done()} label="Buy milk" onPress={toggle} />
<View role="heading">…</View>
<View accessHidden>decoration</View>
```

Roles: `button`, `checkbox`, `switch`, `radio`, `link`, `heading`, `list`, `listItem`, `dialog`, `tab`, `tabList`, `menu`, `menuItem`, `image`, `group`, `status`, `alert`, `none`. Also `selected`, `disabled`.
