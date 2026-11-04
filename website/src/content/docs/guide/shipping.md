---
title: Shipping an app
description: Build one executable, or a macOS app and disk image.
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

Windows and Linux installers are not built yet; `mantou build` gives you the executable.
