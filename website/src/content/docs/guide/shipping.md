---
title: Shipping an app
description: Build one executable, a macOS app and disk image, or Linux packages.
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

Windows installers are not built yet; `mantou build` gives you the executable.
