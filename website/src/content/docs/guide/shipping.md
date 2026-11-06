---
title: Shipping an app
description: Build one executable, a macOS app and disk image, Linux packages, or a Windows installer.
---

```bash
bunx mantou build src/main.tsx --out dist --name my-app
```

This compiles the app and its dependencies to a single executable and copies the native core beside it. Ship the two files together.

## macOS app and .dmg

```bash
bunx mantou package src/main.tsx --id com.example.myapp --version 1.0.0
```

This writes `dist/My App.app` and a `.dmg`, signed ad hoc so it runs on your machine. To distribute it, sign with your Developer ID and notarize:

```bash
bunx mantou package src/main.tsx --id com.example.myapp \
  --identity "Developer ID Application: Your Name (TEAMID)" --notary my-profile
```

`my-profile` is a profile saved with `xcrun notarytool store-credentials`.

The `icon` (an SVG or a large PNG, from `--icon` or the `"mantou"` block of `package.json`, as on Linux and Windows) becomes `Contents/Resources/AppIcon.icns` (16 to 1024 px with @2x) and `CFBundleIconFile` names it, before signing.

## Files embedded in the app

`import icon from "./tray.svg" with { type: "file" }` embeds a file in the executable made by `mantou build` or `package`, at a path inside Bun's virtual filesystem (`/$bunfs/...`, `B:/~BUN/...` on Windows) that the native core can't open. Mantou handles it where a path goes to the core: `createTray({ icon })` writes the embedded file to a temp copy (`mantou-embedded/` in the system temp folder, named by content) and passes that, and `<Image src>` sends the bytes. `file:` URLs from `new URL("./tray.svg", import.meta.url)` work the same. Other paths are untouched.

## Linux packages

```bash
bunx mantou package src/main.tsx --name "My App" --version 1.0.0 --icon assets/icon.svg \
  --categories Network,Email --maintainer "Your Name <you@example.com>"
```

On Linux this writes three files to `dist/`. Pick some with `--linux deb,tar`:

- **`my-app_1.0.0_amd64.deb`:** the app in `/opt/my-app`, a `my-app` launcher in `/usr/bin`, and its menu entry and icons in `/usr/share`. Depends and Recommends default to what the core needs: `libc6 (>= 2.35), libxkbcommon-x11-0, libvulkan1 | libgl1`, and `mesa-vulkan-drivers, zenity | xdg-desktop-portal`. Change them with `--depends` and `--recommends`.
- **`my-app-1.0.0-linux-x64.tar.gz`:** the app with `install.sh` and `uninstall.sh`. These install for the user into `~/.local`, or anywhere with `PREFIX=/usr/local`.
- **`my-app-1.0.0-x86_64.AppImage`:** one file that runs on most distributions. It's made with `appimagetool`, from your `PATH` or `APPIMAGETOOL`. Without one, Mantou downloads a pinned version (checked against its SHA-256) into `~/.cache/mantou`.

The icon can be an SVG (kept as the scalable icon) or a large PNG. It's drawn at 48 to 512 px with a transparent background (`renderImage` from `mantou-ui/png` does the same for your own uses). Without one there's a plain default. The menu entry's `StartupWMClass` is the executable's name, which is the window's `WM_CLASS`, so the desktop groups the window with its icon. Packages are for the machine's own architecture (x64 or arm64), with the core stripped of its debug information.

The same settings can live in `package.json`, so `mantou package src/main.tsx` alone does the rest. Flags win, and the version comes from `"version"`:

```json
{
  "version": "1.2.0",
  "description": "Mail, on your desktop",
  "mantou": {
    "name": "Mantou Mail",
    "id": "dev.dunkbing.mantoumail",
    "icon": "assets/icon.svg",
    "linux": { "formats": ["deb", "tar", "appimage"], "categories": ["Network", "Email"], "maintainer": "Name <mail@example.com>" }
  }
}
```

## Windows installer

```powershell
bunx mantou package src/main.tsx --name "My App" --version 1.0.0 --icon assets/icon.svg `
  --publisher "Your Name" --protocols mailto
```

On Windows this writes `dist/my-app-1.0.0-windows-x64.exe`, an installer that:

- installs the executable and `mantou_ffi.dll` per user into `%LOCALAPPDATA%\Programs\My App`, with no admin rights (`--windows-scope machine` installs into Program Files and asks for admin);
- adds a Start menu shortcut (and a desktop one with `--desktop-shortcut`);
- adds an entry to Apps & features with the icon, version and publisher; uninstalling removes what was installed and leaves the app's data under `%APPDATA%` alone;
- upgrades in place: running it over an older version (even a running one) replaces it in the same folder;
- with `--protocols mailto` (or `myapp`, …), registers the app as a handler for those URL schemes, as a mail client for `mailto`. The app is started with the URL as its argument.

It is silent with `/S`, and `/D=C:\some\dir` picks the folder (it must come last): `my-app-1.0.0-windows-x64.exe /S`. Uninstall silently with the `QuietUninstallString` of the entry, or `uninstall.exe /S`.

The icon (SVG or a large PNG) becomes an `.ico` of 16 to 256 px, embedded in the executable and used by the shortcuts; the executable also gets a version resource (name, version, publisher, description), so Explorer and SmartScreen show them. Bun's compiler writes both, so there is no resource editor to install.

**Signing.** Unsigned installers work, with SmartScreen's warning. To sign the executable, the DLL and the installer with Authenticode and a timestamp, pass a certificate in the store (`--sign-thumbprint SHA1`) or a `.pfx` (`--sign-pfx file.pfx`, with the password in `MANTOU_SIGN_PASSWORD` or `--sign-password`). `signtool` comes from the Windows SDK (or `SIGNTOOL`); the timestamp server is `--timestamp URL` (default DigiCert's). For a cloud signer such as Azure Trusted Signing, put its `signtool` arguments in `"windows": { "sign": { "args": ["/dlib", "…", "/dmdf", "…"] } }`. The uninstaller inside the installer is not signed.

**Why NSIS.** The installer is made with [NSIS](https://nsis.sourceforge.io) (`choco install nsis`, `brew install makensis`, `apt install nsis`; or set `MAKENSIS`): one small program that compiles a text script, with silent mode and per-user installs built in. WiX would need its .NET toolset and makes an `.msi`, which is better for managed fleets but heavier to build and test on a CI runner. The app itself is still built on Windows, since it needs the Windows core.

The same settings in `package.json`:

```json
{
  "mantou": {
    "name": "Mantou Mail",
    "id": "dev.dunkbing.mantoumail",
    "icon": "assets/icon.svg",
    "windows": { "format": "nsis", "scope": "user", "publisher": "Your Name", "protocols": ["mailto"], "desktopShortcut": false }
  }
}
```

CI installs the counter this way on a Windows runner (silently, into a temp folder), checks the shortcut, the entry, the version resource and the registration, starts it, installs over it, uninstalls it, and checks that everything is gone.

## Updating an installed app

An app checks a **feed**, a JSON file you host anywhere (GitHub release assets work), downloads the build for its platform, and restarts into it.

```tsx
import { checkForUpdate } from "mantou-ui";
import pkg from "../package.json";

const u = await checkForUpdate({ url: "https://github.com/me/app/releases/latest/download/latest.json", version: pkg.version });
if (u) {
  if (u.canInstall) await u.install({ onProgress: (done, total) => setPercent(total ? done / total : 0) }); // quits and restarts
  else openExternal(u.url); // show the link
}
```

`checkForUpdate` resolves `null` when the feed's version isn't newer (semver order, prereleases below their release) or has no build for this platform, and throws an `UpdateError` for a feed that can't be read. `install()` downloads, checks the SHA-256 (and the signature), applies the update and quits the app (through `win.close()`, so a `quitOnClose: false` app should quit itself when it resolves `"restarting"`); it resolves `"manual"` without doing anything when `canInstall` is false. `u.download()` alone returns the verified file's path.

**The feed**, `latest.json`:

```json
{
  "version": "1.2.0",
  "notes": "Fixes the sidebar",
  "platforms": {
    "darwin-arm64": { "url": "https://…/My-App-1.2.0.dmg", "sha256": "…", "size": 41234567 },
    "linux-x64": { "url": "https://…/my-app-1.2.0-x86_64.AppImage", "sha256": "…" },
    "windows-x64": { "url": "https://…/My-App-Setup-1.2.0.exe", "sha256": "…", "signature": "…" }
  }
}
```

Keys are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`. `mantou package … --update-url https://…/download/v1.2.0` (or `"update": { "url": … }` in the `"mantou"` block) writes it as `dist/latest.json`, with the hash of the file this machine made and `--update-notes`. Run it on each OS (one runner per platform): a feed of the same version already in `dist/` gains the new platform. Upload the feed and the files; with a stable URL for the feed (GitHub's `releases/latest/download/latest.json`), published apps find new versions.

**What each platform does.**

| Platform | Update file | Applied by |
|---|---|---|
| macOS | `.dmg` (or a `.zip` of the `.app`) | The `.app` is copied out of the image next to the installed one, checked, then swapped in by a helper after the app quits; the old bundle is kept until the swap worked, and put back if it didn't. Needs write access to the app's folder. |
| Linux, AppImage | `.AppImage` | Copied next to the running AppImage (`$APPIMAGE`), then renamed over it by a helper once the app quits. |
| Linux, `.deb` or tarball | | `canInstall` is false: show `u.url`. |
| Windows | the NSIS `.exe` | A helper waits for the app to quit, runs the installer silently (`/S`) and starts the app. A per-user installer needs no prompt; a per-machine one asks for elevation. |

Everything that can fail (download, checksum, signature, unpacking, staging) happens before the app quits, so a failed update throws and leaves the installed app as it was.

**Signing the feed.** A hash in a file served from the same place as the build doesn't stop someone who controls that place. To pin a key: `mantou update-keygen` writes `update-key.pem` (keep it secret) and prints a public key; build with `--update-key update-key.pem` (or `"update": { "key": … }`), which signs each build's hash (Ed25519) into the feed; pass the public key as `checkForUpdate({ publicKey })` and any build without a valid signature is refused. This is in addition to code signing and notarization, not instead of it.

**Tested, and not.** The feed, version order, download, hash and signature checks and the steps run in unit tests with fakes, and the macOS image staging and the swap script ran for real on macOS. Not exercised on real installs: the Windows installer run and relaunch, an AppImage restart on Linux, and macOS with a notarized app in `/Applications`.
