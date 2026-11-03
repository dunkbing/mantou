#!/usr/bin/env bun
// The `mantou` command, for apps that depend on mantou-ui:
//
//   mantou build-core                 build the native core (once, and after updating mantou-ui)
//   mantou run <entry> [options]      run an app: --width N --height N --title T
import { existsSync } from "node:fs";
import { join } from "node:path";
import { libPath } from "./ffi";

const USAGE = `usage:
  mantou build-core                       build the native core (needs Rust: https://rustup.rs)
  mantou run <entry.tsx> [--width N] [--height N] [--title T]`;

const [command, ...rest] = Bun.argv.slice(2);
switch (command) {
  case "run": {
    const entry = rest.find((a) => !a.startsWith("--"));
    if (!entry) {
      console.error(USAGE);
      process.exit(2);
    }
    if (!existsSync(libPath())) {
      console.error("mantou: the native core isn't built yet; run `mantou build-core` first");
      process.exit(2);
    }
    const { start } = await import("./main");
    await start(entry, rest);
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
  default:
    console.error(USAGE);
    process.exit(command ? 2 : 0);
}
