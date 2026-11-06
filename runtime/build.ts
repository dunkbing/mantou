// `mantou build` and `mantou package` (design §13.2): one executable with Bun,
// the app (JSX compiled ahead of time, so no Babel at run time) and the Worker
// entry; `package` wraps it and the native core into a macOS .app and .dmg.
import { existsSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { libPath } from "./ffi";
import { makeIcns } from "./icns";
import { mantouJsx } from "./solid/plugin";

const runtime = import.meta.dir;

function run(cmd: string[]) {
  const p = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`mantou: \`${cmd.join(" ")}\` failed (${p.exitCode})`);
}

/** What Bun's compiler embeds in a Windows executable: its icon (.ico) and version resource. */
export interface WindowsResources {
  hideConsole?: boolean;
  icon?: string;
  title?: string;
  publisher?: string;
  version?: string;
  description?: string;
  copyright?: string;
}

/** Compiles `entry` into `<outDir>/<name>` with the core beside it. Returns the executable's path. */
export async function build(entry: string, outDir: string, name: string, windows?: WindowsResources): Promise<string> {
  const app = resolve(entry);
  if (!existsSync(app)) throw new Error(`mantou: no such entry: ${entry}`);
  const core = libPath();
  if (!existsSync(core)) throw new Error(`mantou: no native core at ${core}; run \`mantou build-core\``);

  // Generated entries live in a directory of their own so they never shadow app files.
  const gen = join(outDir, ".gen");
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });
  const q = (p: string) => JSON.stringify(p);
  // Bun's compiler only embeds a Worker whose path is a literal beside an extra entry point.
  const boot = join(gen, "boot.ts");
  const worker = join(gen, "app-worker.ts");
  writeFileSync(boot, `import { start } from ${q(join(runtime, "main.ts"))};\nawait start("", Bun.argv.slice(2), new Worker(new URL("./app-worker.ts", import.meta.url).href));\n`);
  writeFileSync(
    worker,
    `globalThis.addEventListener("message", async (e: Event) => {
  const data = (e as MessageEvent).data;
  if (data?.type !== "mantou:entry") return;
  if (data.argv) process.argv = [process.argv[0], data.entry, ...data.argv];
  try { await import(${q(app)}); } catch (err) { console.error("mantou: the app failed to load:", err); postMessage({ type: "mantou:failed", error: String((err as Error)?.stack ?? err) }); }
}, { once: true });\n`,
  );

  const exe = join(outDir, name);
  // The baseline Bun runs on x64 CPUs without AVX2 (old CPUs, Windows 11 on ARM and VMs that hide it); the regular one crashes at start there.
  const r = await Bun.build({ entrypoints: [boot, worker], plugins: [mantouJsx], compile: { outfile: exe, ...(process.platform === "win32" && process.arch === "x64" ? { target: "bun-windows-x64-baseline" } : {}), ...(windows && process.platform === "win32" ? { windows } : {}) } as never });
  if (!r.success) throw new Error(`mantou: build failed:\n${r.logs.join("\n")}`);
  rmSync(gen, { recursive: true, force: true });
  copyFileSync(core, join(dirname(exe), basename(core)));
  return exe;
}

export interface PackageOptions {
  name: string;
  /** Reverse-DNS bundle identifier. */
  id: string;
  version: string;
  /** A codesign identity; "-" (the default) signs ad hoc. */
  identity: string;
  /** A notarytool keychain profile; without one the app is signed but not notarized. */
  notary?: string;
  dmg: boolean;
  /** An SVG or a large PNG, made into the app's .icns. */
  icon?: string;
}

// JavaScriptCore's JIT needs allow-jit; Bun's compiled executable also needs
// unsigned executable memory under the hardened runtime.
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
`;

const plist = (o: PackageOptions) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${o.name}</string>
<key>CFBundleDisplayName</key><string>${o.name}</string>
<key>CFBundleIdentifier</key><string>${o.id}</string>
<key>CFBundleExecutable</key><string>${o.name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
${o.icon ? "<key>CFBundleIconFile</key><string>AppIcon</string>\n" : ""}<key>CFBundleShortVersionString</key><string>${o.version}</string>
<key>CFBundleVersion</key><string>${o.version}</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;

/** Builds `entry` into `<outDir>/<name>.app` (and a .dmg), signed. macOS only. */
export async function packageMac(entry: string, outDir: string, o: PackageOptions): Promise<string> {
  if (process.platform !== "darwin") throw new Error("mantou package: only macOS is supported so far");
  outDir = resolve(outDir);
  const app = join(outDir, `${o.name}.app`);
  rmSync(app, { recursive: true, force: true });
  const macos = join(app, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  const exe = await build(entry, macos, o.name);
  chmodSync(exe, 0o755);
  writeFileSync(join(app, "Contents", "Info.plist"), plist(o));
  if (o.icon) {
    if (!existsSync(o.icon)) throw new Error(`mantou package: no such icon: ${o.icon}`);
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(app, "Contents", "Resources", "AppIcon.icns"), makeIcns(new Uint8Array(readFileSync(o.icon))));
  }
  const ent = join(outDir, ".entitlements.plist");
  writeFileSync(ent, ENTITLEMENTS);

  // Inside out: the core, then the executable, then the bundle. A real identity gets the hardened runtime and a timestamp.
  const real = o.identity !== "-";
  const sign = (path: string, extra: string[] = []) =>
    run(["codesign", "--force", "--sign", o.identity, ...(real ? ["--options", "runtime", "--timestamp"] : []), ...extra, path]);
  sign(join(macos, basename(libPath())));
  sign(exe, ["--entitlements", ent]);
  sign(app, ["--entitlements", ent]);
  run(["codesign", "--verify", "--strict", "--deep", app]);
  rmSync(ent);

  let out = app;
  if (o.dmg) {
    out = join(outDir, `${o.name}-${o.version}.dmg`);
    rmSync(out, { force: true });
    run(["hdiutil", "create", "-volname", o.name, "-srcfolder", app, "-ov", "-format", "UDZO", out]);
    if (real) run(["codesign", "--force", "--sign", o.identity, "--timestamp", out]);
  }
  if (o.notary) {
    if (!real) throw new Error("mantou package: notarization needs a Developer ID identity (--identity)");
    run(["xcrun", "notarytool", "submit", out, "--keychain-profile", o.notary, "--wait"]);
    run(["xcrun", "stapler", "staple", out]);
  }
  return out;
}
