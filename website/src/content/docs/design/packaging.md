---
title: Packaging
description: How Mantou apps are packaged and distributed on macOS, Windows and Linux.
---

## 13. Packaging and distribution

- `bun build --compile ./main.ts ./app-worker.ts` produces a single executable containing both the bootstrap and the Worker entry. Verified with Bun 1.4.4 on Linux: the Worker entry must be listed as an extra entry point, and `bun:ffi` works inside the compiled Worker.
- The native core: `dlopen` needs a real file. Ship it beside the binary inside the bundle, or embed it and extract it to a cache directory named by a content hash on first run.
- **macOS:**
  - `.app` bundle, plus a `.dmg`.
  - Code signing with the hardened runtime. JavaScriptCore's JIT requires the `com.apple.security.cs.allow-jit` entitlement.
  - Notarization.
- **Windows:** an installer (MSI or NSIS), signed with Authenticode.
- **Linux:** AppImage and `.deb`. Runtime dependencies are few: Vulkan or GL drivers, and the libraries winit needs (Wayland/X11, xkbcommon).
- **Size:** dominated by the Bun runtime. A minimal compiled bootstrap + Worker measured about 109 MB (104 MiB) on Linux x64 with Bun 1.4.4, before the native core. Track it in CI, and check whether compression in the installers (DMG, MSI or NSIS, AppImage) brings the download down substantially.
