---
title: Packaging
description: How Mantou apps are packaged and distributed on macOS, Windows and Linux.
---

## 13. Packaging and distribution

### 13.1 The mantou-ui package

Apps get Mantou from npm: `bun add mantou-ui`. The package holds the runtime as TypeScript (Bun runs it as is), the `mantou` command, and the core's Rust sources. The core itself comes prebuilt, one package per platform, each listed as an optional dependency, so the package manager installs only the one that matches the machine (their `os` and `cpu` fields):

| Package | Built on |
|---|---|
| `mantou-ui-linux-x64` | Ubuntu 22.04, so it runs with glibc 2.35 and newer |
| `mantou-ui-linux-arm64` | Ubuntu 22.04 on arm64 |
| `mantou-ui-darwin-arm64` | macOS 14, for macOS 11 and newer |
| `mantou-ui-darwin-x64` | macOS 14, cross-compiled |
| `mantou-ui-windows-x64` | Windows Server 2022 |

The runtime loads `MANTOU_CORE` if it's set, else a core built from the package's own sources (`mantou build-core`, which needs Rust), else the prebuilt one. So a platform without a prebuilt core, or an app that depends on mantou-ui from GitHub, still works after one build. Released cores are built with the `dist` profile (`core/Cargo.toml`): link-time optimization in one unit, no debug info, symbols stripped, and size over speed for the big parts that never run per frame (the HTML/CSS engine, accessibility, dialogs). On Linux that's about 25 MB, 11 MB compressed, against 36 MB for a plain stripped `--release` build, with no measurable cost in speed (see Performance). `mantou build-core` builds the same way.

Releases are made by `.github/workflows/release.yml` from a version tag. It builds every core, packs every package, installs them from the tarballs into a fresh app on Linux (x64, arm64), macOS and Windows and runs a headless test there, and only then publishes, platform packages first, with npm provenance. It ends by installing the published version from npm on the same machines and testing it again.

### 13.2 Apps

- `bun build --compile ./main.ts ./app-worker.ts` produces a single executable containing both the bootstrap and the Worker entry. Verified with Bun 1.4.4 on Linux: the Worker entry must be listed as an extra entry point, and `bun:ffi` works inside the compiled Worker.
- The native core: `dlopen` needs a real file. Ship it beside the binary inside the bundle, or embed it and extract it to a cache directory named by a content hash on first run.
- **macOS:**
  - `.app` bundle, plus a `.dmg`.
  - Code signing with the hardened runtime. JavaScriptCore's JIT requires the `com.apple.security.cs.allow-jit` entitlement.
  - Notarization.
- **`mantou build <entry>`** compiles the app (JSX ahead of time, through Mantou's plugin, so no Babel at run time) into one executable and copies the core beside it. **`mantou package <entry>`** (macOS) wraps both in `Name.app/Contents/MacOS`, writes `Info.plist`, signs the core, the executable and the bundle in that order, and makes a `.dmg`. `--identity "Developer ID Application: …"` turns on the hardened runtime and a timestamp; `--notary PROFILE` (a `xcrun notarytool store-credentials` profile) submits, waits and staples. Without an identity the bundle is signed ad hoc.
- **Measured on macOS (Apple M4, Bun 1.4.4), the to-do example:** executable 89 MB, core 12.8 MB, `.dmg` 50 MB. It starts, loads the app in the embedded Worker and stays in the native loop, signed ad hoc and ad hoc with the hardened runtime. Under the hardened runtime the executable **crashes at start without the entitlements** (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`), which `package` always passes. Not yet checked: Developer ID signing and notarization, and time to first frame.
- **Windows:** an installer (MSI or NSIS), signed with Authenticode.
- **Linux:** AppImage and `.deb`. Runtime dependencies are few: Vulkan or GL drivers, and the libraries winit needs (Wayland/X11, xkbcommon).
- **Size:** dominated by the Bun runtime. A minimal compiled bootstrap + Worker measured about 109 MB (104 MiB) on Linux x64 with Bun 1.4.4, before the native core. Track it in CI, and check whether compression in the installers (DMG, MSI or NSIS, AppImage) brings the download down substantially.
