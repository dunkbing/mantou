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
