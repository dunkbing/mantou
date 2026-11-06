#!/usr/bin/env bun
// The `mantou` command, for apps that depend on mantou-ui:
//
//   mantou create <dir>               a starter app: a counter with a test
//   mantou build-core                 build the native core from source (only without a prebuilt one, or to change it)
//   mantou run <entry> [options]      run an app: --width N --height N --min-width N --min-height N --title T (flags win over run()'s options)
//   mantou dev <entry> [options]      run it, and reload it when a file changes, keeping the window (--watch DIR)
//   mantou snap <entry> [options]     run it headless: a screenshot, the tree, scenes, scripted input, motion checks
//   mantou build <entry> [--out DIR] [--name N]       compile the app to one executable (the core beside it)
//   mantou package <entry> [options]  macOS: a signed .app and .dmg; Linux: a .deb, a .tar.gz and an AppImage;
//                                     Windows: an NSIS installer (see USAGE)
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { libPath } from "./ffi";
import { SNAP_USAGE } from "./snap-usage";

const USAGE = `usage:
  mantou create <dir>                     a starter app (a counter with a test) in a new folder
  mantou build-core                       build the native core from source (needs Rust: https://rustup.rs);
                                          not needed where mantou-ui ships a prebuilt one
  mantou run <entry.tsx> [--width N] [--height N] [--min-width N] [--min-height N] [--title T]
  mantou dev <entry.tsx> [--watch DIR] [--snap [shot.png]] [same options as run]
                                          run it, and reload it when a file under DIR (default: the entry's folder)
                                          changes, keeping the window; errors show in the window until the next save;
                                          --snap writes a headless screenshot and the tree (shot.txt) after each
                                          start and reload (default .mantou/dev-snap.png): an agent sees its edit land
  ${SNAP_USAGE.replace(/\n/g, "\n  ")}
  mantou build <entry.tsx> [--out DIR] [--name N]
                                          compile the app to one executable; the native core is copied beside it
  mantou package <entry.tsx> [--out DIR] [--name N] [--id com.example.app] [--version 1.0.0]
                 [--identity "Developer ID Application: …"] [--notary PROFILE] [--no-dmg]
                                          macOS: a hardened-runtime .app and .dmg; signed ad hoc without --identity,
                                          notarized and stapled with --notary (a \`xcrun notarytool store-credentials\` profile);
                                          --icon (SVG or large PNG) becomes the .icns; options also come from package.json's "mantou" block
                 [--linux deb,tar,appimage] [--icon icon.svg] [--description D] [--categories Network,Email]
                 [--keywords K,L] [--maintainer "Name <mail>"] [--homepage URL] [--depends A,B] [--recommends A,B]
                                          Linux: a .deb, a .tar.gz (install.sh, uninstall.sh) and an AppImage, with a
                                          .desktop entry and icons; options also come from package.json's "mantou" block
                 [--publisher P] [--windows-scope user|machine] [--protocols mailto] [--desktop-shortcut]
                 [--sign-thumbprint SHA1 | --sign-pfx FILE [--sign-password PW]] [--timestamp URL]
                                          Windows: an NSIS installer (per user, no admin, by default) with a Start menu
                                          shortcut, an Apps & features entry and the icon; signed with signtool if asked`;

const [command, ...rest] = Bun.argv.slice(2);
switch (command) {
  case "run":
  case "dev": {
    const watchAt = rest.indexOf("--watch");
    const watchDir = watchAt >= 0 ? rest[watchAt + 1] : undefined;
    // --snap [PATH]: after each start and reload, a headless screenshot and the tree (for agents watching).
    const snapAt = command === "dev" ? rest.indexOf("--snap") : -1;
    const snapValue = snapAt >= 0 && rest[snapAt + 1]?.endsWith(".png") ? rest[snapAt + 1] : undefined;
    if (snapAt >= 0) process.env.MANTOU_DEV_SNAP = resolve(snapValue ?? join(".mantou", "dev-snap.png"));
    const entry = rest.find((a, i) => !a.startsWith("--") && (watchAt < 0 || i !== watchAt + 1) && !(snapValue && i === snapAt + 1));
    if (!entry) {
      console.error(USAGE);
      process.exit(2);
    }
    if (!existsSync(libPath())) {
      console.error("mantou: no native core for this platform; build one with `mantou build-core` (needs Rust)");
      process.exit(2);
    }
    const { start } = await import("./main");
    await start(entry, rest, undefined, command === "dev" ? { watch: watchDir ?? dirname(entry) } : undefined);
    break;
  }
  case "snap": {
    if (!existsSync(libPath())) {
      console.error("mantou: no native core for this platform; build one with `mantou build-core` (needs Rust)");
      process.exit(2);
    }
    const { snap } = await import("./snap");
    process.exit(await snap(rest));
  }
  case "create": {
    const dir = rest.find((a) => !a.startsWith("--"));
    if (!dir) {
      console.error(USAGE);
      process.exit(2);
    }
    try {
      const { create } = await import("./create");
      create(dir);
      console.log(`mantou: created ${dir}\n  cd ${dir} && bun install\n  bun run dev     # open the window\n  bun test        # headless tests`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    break;
  }
  case "build-core": {
    const manifest = join(import.meta.dir, "..", "core", "Cargo.toml");
    if (!Bun.which("cargo")) {
      console.error("mantou: cargo not found; install Rust from https://rustup.rs and run this again");
      process.exit(2);
    }
    const p = Bun.spawn(["cargo", "build", "--release", "--manifest-path", manifest, "-p", "mantou-ffi"], { stdio: ["inherit", "inherit", "inherit"] });
    const code = await p.exited;
    if (code === 0) console.log(`mantou: native core built: ${libPath()}`);
    process.exit(code);
  }
  case "build":
  case "package": {
    const entry = rest.find((a, i) => !a.startsWith("--") && !(rest[i - 1] ?? "").startsWith("--"));
    if (!entry) {
      console.error(USAGE);
      process.exit(2);
    }
    const opt = (n: string) => rest[rest.indexOf(`--${n}`) + 1] && rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : undefined;
    const list = (n: string) => opt(n)?.split(",").map((s) => s.trim()).filter(Boolean);
    const { readConfig } = await import("./package-linux");
    const pkg = readConfig(process.cwd());
    const cfg = pkg.config;
    const name = opt("name") ?? cfg.name ?? basename(entry).replace(/\.[^.]+$/, "");
    const out = opt("out") ?? "dist";
    const version = opt("version") ?? pkg.version ?? "1.0.0";
    try {
      const b = await import("./build");
      let made: string | string[];
      if (command === "build") made = await b.build(entry, out, name);
      else if (process.platform === "win32") {
        const w = cfg.windows;
        if (w?.format && w.format !== "nsis") throw new Error(`mantou package: Windows format "${w.format}" isn't supported (only "nsis")`);
        const scope = opt("windows-scope") ?? w?.scope;
        if (scope && scope !== "user" && scope !== "machine") throw new Error(`mantou package: --windows-scope is "user" or "machine", not "${scope}"`);
        const thumbprint = opt("sign-thumbprint") ?? w?.sign?.thumbprint;
        const pfx = opt("sign-pfx") ?? w?.sign?.pfx;
        const { packageWindows } = await import("./package-windows");
        made = await packageWindows(entry, out, {
          name,
          version,
          id: opt("id") ?? cfg.id,
          description: opt("description") ?? cfg.description ?? pkg.description,
          icon: opt("icon") ?? cfg.icon,
          publisher: opt("publisher") ?? w?.publisher,
          scope: scope as "user" | "machine" | undefined,
          protocols: list("protocols") ?? w?.protocols,
          desktopShortcut: rest.includes("--desktop-shortcut") || w?.desktopShortcut,
          sign: thumbprint || pfx || w?.sign?.args
            ? { thumbprint, pfx, password: opt("sign-password") ?? w?.sign?.password, args: w?.sign?.args, timestamp: opt("timestamp") ?? w?.sign?.timestamp }
            : undefined,
        });
      } else if (process.platform === "linux") {
        const { packageLinux } = await import("./package-linux");
        made = await packageLinux(entry, out, {
          name,
          version,
          slug: cfg.linux?.slug,
          description: opt("description") ?? cfg.description ?? pkg.description,
          icon: opt("icon") ?? cfg.icon,
          formats: (list("linux") ?? cfg.linux?.formats) as ("deb" | "tar" | "appimage")[] | undefined,
          categories: list("categories") ?? cfg.linux?.categories,
          keywords: list("keywords") ?? cfg.linux?.keywords,
          maintainer: opt("maintainer") ?? cfg.linux?.maintainer,
          homepage: opt("homepage") ?? cfg.homepage ?? pkg.homepage,
          depends: list("depends") ?? cfg.linux?.depends,
          recommends: list("recommends") ?? cfg.linux?.recommends,
        });
      } else
        made = await b.packageMac(entry, out, {
          name,
          id: opt("id") ?? cfg.id ?? `com.example.${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
          version,
          identity: opt("identity") ?? "-",
          notary: opt("notary"),
          dmg: !rest.includes("--no-dmg"),
          icon: opt("icon") ?? cfg.icon,
        });
      for (const m of [made].flat()) console.log(`mantou: ${m}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 2 : 0);
}
