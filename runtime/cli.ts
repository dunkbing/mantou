#!/usr/bin/env bun
// The `mantou` command, for apps that depend on mantou-ui:
//
//   mantou create <dir>               a starter app: a counter with a test
//   mantou build-core                 build the native core from source (only without a prebuilt one, or to change it)
//   mantou run <entry> [options]      run an app: --width N --height N --min-width N --min-height N --title T (flags win over run()'s options)
//   mantou dev <entry> [options]      run it, and reload it when a file changes, keeping the window (--watch DIR)
//   mantou build <entry> [--out DIR] [--name N]       compile the app to one executable (the core beside it)
//   mantou package <entry> [options]  macOS: a signed .app and .dmg (see USAGE)
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { libPath } from "./ffi";

const USAGE = `usage:
  mantou create <dir>                     a starter app (a counter with a test) in a new folder
  mantou build-core                       build the native core from source (needs Rust: https://rustup.rs);
                                          not needed where mantou-ui ships a prebuilt one
  mantou run <entry.tsx> [--width N] [--height N] [--min-width N] [--min-height N] [--title T]
  mantou dev <entry.tsx> [--watch DIR] [same options as run]
                                          run it, and reload it when a file under DIR (default: the entry's folder)
                                          changes, keeping the window; errors show in the window until the next save
  mantou build <entry.tsx> [--out DIR] [--name N]
                                          compile the app to one executable; the native core is copied beside it
  mantou package <entry.tsx> [--out DIR] [--name N] [--id com.example.app] [--version 1.0.0]
                 [--identity "Developer ID Application: …"] [--notary PROFILE] [--no-dmg]
                                          macOS: a hardened-runtime .app and .dmg; signed ad hoc without --identity,
                                          notarized and stapled with --notary (a \`xcrun notarytool store-credentials\` profile)`;

const [command, ...rest] = Bun.argv.slice(2);
switch (command) {
  case "run":
  case "dev": {
    const watchAt = rest.indexOf("--watch");
    const watchDir = watchAt >= 0 ? rest[watchAt + 1] : undefined;
    const entry = rest.find((a, i) => !a.startsWith("--") && (watchAt < 0 || i !== watchAt + 1));
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
    const name = opt("name") ?? basename(entry).replace(/\.[^.]+$/, "");
    const out = opt("out") ?? "dist";
    try {
      const b = await import("./build");
      const made =
        command === "build"
          ? await b.build(entry, out, name)
          : await b.packageMac(entry, out, {
              name,
              id: opt("id") ?? `com.example.${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
              version: opt("version") ?? "1.0.0",
              identity: opt("identity") ?? "-",
              notary: opt("notary"),
              dmg: !rest.includes("--no-dmg"),
            });
      console.log(`mantou: ${made}`);
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
