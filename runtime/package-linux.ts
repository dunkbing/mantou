// `mantou package` on Linux (dunkbing/mantou#81): the app built with `mantou build`, as a .deb, a .tar.gz with
// install.sh and uninstall.sh, and an AppImage, each with a .desktop entry and hicolor icons.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "./build";
import { libPath } from "./ffi";
import { encodePng, renderImage } from "./png";
import type { WindowsPackageOptions } from "./package-windows";

export type LinuxFormat = "deb" | "tar" | "appimage";

export interface LinuxPackageOptions {
  /** The app's name as people see it ("Mantou Mail"). */
  name: string;
  /** The package and executable name ("mantou-mail"); by default from `name`. It's also the window's WM_CLASS. */
  slug?: string;
  version: string;
  /** One line: the .desktop entry's Comment and the package's description. */
  description?: string;
  /** An SVG (kept as the scalable icon) or a large PNG; without one, a plain default icon. */
  icon?: string;
  formats?: LinuxFormat[];
  /** freedesktop.org categories ("Network", "Email"). */
  categories?: string[];
  keywords?: string[];
  /** "Name <mail@example.com>" (the .deb's Maintainer). */
  maintainer?: string;
  homepage?: string;
  /** The .deb's Depends and Recommends (defaults: what the core needs, and what file dialogs use). */
  depends?: string[];
  recommends?: string[];
}

const DEPENDS = ["libc6 (>= 2.35)", "libxkbcommon-x11-0", "libvulkan1 | libgl1"];
const RECOMMENDS = ["mesa-vulkan-drivers", "zenity | xdg-desktop-portal"];
const ICON_SIZES = [48, 64, 128, 256, 512];

// A rounded square with a window in it, for apps without an icon.
export const DEFAULT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect x="32" y="32" width="448" height="448" rx="100" fill="url(#g)"/><rect x="128" y="156" width="256" height="200" rx="24" fill="#fff"/><rect x="128" y="156" width="256" height="48" rx="24" fill="#bfdbfe"/><rect x="128" y="180" width="256" height="24" fill="#bfdbfe"/></svg>`;

// appimagetool and the AppImage runtime, pinned with their SHA-256 (used when appimagetool isn't on PATH).
const APPIMAGETOOL = "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-{arch}.AppImage";
const RUNTIME = "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-{arch}";
const SHA256: Record<string, string> = {
  "appimagetool-x86_64": "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0",
  "appimagetool-aarch64": "f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158",
  "runtime-x86_64": "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d",
  "runtime-aarch64": "00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444",
};

/** "Mantou Mail" → "mantou-mail": what Debian allows in a package name. */
export function slugOf(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9.+-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
  return s.length >= 2 ? s : `app-${s}`.replace(/-$/, "");
}

function run(cmd: string[], env?: Record<string, string>) {
  const p = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", env: { ...process.env, ...env } });
  if (p.exitCode !== 0) throw new Error(`mantou: \`${cmd.join(" ")}\` failed (${p.exitCode})`);
}

/** A .desktop value: one line. */
const line = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function desktopEntry(o: Required<Pick<LinuxPackageOptions, "name" | "slug">> & LinuxPackageOptions, exec: string): string {
  const list = (v: string[] | undefined) => (v?.length ? v.map(line).join(";") + ";" : undefined);
  const fields: [string, string | undefined][] = [
    ["Type", "Application"],
    ["Name", line(o.name)],
    ["Comment", o.description && line(o.description)],
    ["Exec", `${exec} %U`],
    ["Icon", o.slug],
    ["Terminal", "false"],
    ["Categories", list(o.categories) ?? "Utility;"],
    ["Keywords", list(o.keywords)],
    // winit sets the window's WM_CLASS to the executable's name: the desktop groups the window with this entry.
    ["StartupWMClass", o.slug],
  ];
  return "[Desktop Entry]\n" + fields.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

/** Writes the icons under `<share>/icons/hicolor` (PNGs at each size, and the SVG as scalable); returns the 256 px PNG. */
function writeIcons(share: string, slug: string, icon: Uint8Array, svg: boolean): Uint8Array {
  let png256: Uint8Array = new Uint8Array();
  for (const size of ICON_SIZES) {
    const dir = join(share, "icons", "hicolor", `${size}x${size}`, "apps");
    mkdirSync(dir, { recursive: true });
    const png = encodePng(renderImage(icon, size, size));
    writeFileSync(join(dir, `${slug}.png`), png);
    if (size === 256) png256 = png;
  }
  if (svg) {
    const dir = join(share, "icons", "hicolor", "scalable", "apps");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug}.svg`), icon);
  }
  return png256;
}

/** Bytes under `dir`, for the .deb's Installed-Size. */
function sizeOf(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? sizeOf(p) : e.isSymbolicLink() ? 0 : statSync(p).size;
  }
  return n;
}

/** An `ar` archive (what a .deb is): `debian-binary`, then the control and data tarballs. */
function arArchive(members: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode("!<arch>\n")];
  const now = Math.floor(Date.now() / 1000);
  for (const [name, data] of members) {
    const field = (v: string | number, n: number) => String(v).padEnd(n, " ").slice(0, n);
    parts.push(enc.encode(field(name, 16) + field(now, 12) + field(0, 6) + field(0, 6) + field(100644, 8) + field(data.length, 10) + "`\n"));
    parts.push(data);
    if (data.length % 2) parts.push(enc.encode("\n"));
  }
  return Buffer.concat(parts);
}

export function makeDeb(root: string, out: string) {
  // dpkg-deb when it's there; otherwise the same archive by hand (any distribution can build a .deb).
  if (!process.env.MANTOU_NO_DPKG && Bun.which("dpkg-deb")) return run(["dpkg-deb", "--root-owner-group", "--build", root, out]);
  const tmp = `${out}.parts`;
  mkdirSync(tmp, { recursive: true });
  const owner = ["--owner=0", "--group=0", "--numeric-owner"];
  run(["tar", "-czf", join(tmp, "control.tar.gz"), ...owner, "-C", join(root, "DEBIAN"), "."]);
  const top = readdirSync(root).filter((n) => n !== "DEBIAN").map((n) => `./${n}`);
  run(["tar", "-czf", join(tmp, "data.tar.gz"), ...owner, "-C", root, ...top]);
  writeFileSync(out, arArchive([
    ["debian-binary", new TextEncoder().encode("2.0\n")],
    ["control.tar.gz", readFileSync(join(tmp, "control.tar.gz"))],
    ["data.tar.gz", readFileSync(join(tmp, "data.tar.gz"))],
  ]));
  rmSync(tmp, { recursive: true, force: true });
}

/** A file from `url` into the cache (once), checked against its SHA-256. */
async function fetchPinned(key: string, url: string): Promise<string> {
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "mantou", "appimage");
  const file = join(dir, basename(url));
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  if (existsSync(file) && sha(readFileSync(file)) === SHA256[key]) return file;
  mkdirSync(dir, { recursive: true });
  const r = await fetch(url).catch((e) => {
    throw new Error(`mantou: can't download ${url} (${e}); install appimagetool, or set APPIMAGETOOL`);
  });
  if (!r.ok) throw new Error(`mantou: can't download ${url} (HTTP ${r.status}); install appimagetool, or set APPIMAGETOOL`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (sha(bytes) !== SHA256[key]) throw new Error(`mantou: ${url} isn't the file expected (its SHA-256 differs)`);
  writeFileSync(file, bytes);
  chmodSync(file, 0o755);
  return file;
}

async function makeAppImage(appDir: string, out: string, arch: string) {
  const tool = process.env.APPIMAGETOOL || Bun.which("appimagetool") || (await fetchPinned(`appimagetool-${arch}`, APPIMAGETOOL.replace("{arch}", arch)));
  const runtime = process.env.APPIMAGE_RUNTIME || (await fetchPinned(`runtime-${arch}`, RUNTIME.replace("{arch}", arch)));
  // appimagetool is an AppImage itself: extracting it instead of mounting works without FUSE (containers, CI).
  run([tool, "--no-appstream", "--runtime-file", runtime, appDir, out], { ARCH: arch, APPIMAGE_EXTRACT_AND_RUN: "1" });
}

/** Builds `entry` and packages it for Linux into `outDir`. Returns the files written. */
export async function packageLinux(entry: string, outDir: string, opts: LinuxPackageOptions): Promise<string[]> {
  if (process.platform !== "linux") throw new Error("mantou package: Linux packages are made on Linux");
  const o = { ...opts, slug: opts.slug ?? slugOf(opts.name) };
  const formats = o.formats?.length ? o.formats : (["deb", "tar", "appimage"] as LinuxFormat[]);
  const arch = process.arch === "arm64" ? { deb: "arm64", tar: "arm64", appimage: "aarch64" } : { deb: "amd64", tar: "x64", appimage: "x86_64" };
  outDir = resolve(outDir);
  const stage = join(outDir, `.linux-${o.slug}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // The app: the executable and the core beside it.
  const app = join(stage, "app");
  mkdirSync(app, { recursive: true });
  const exe = await build(entry, app, o.slug);
  chmodSync(exe, 0o755);
  const core = basename(libPath());
  // The core is built with line tables for crash backtraces; packages don't need its debug sections.
  if (Bun.which("strip")) run(["strip", "--strip-debug", join(app, core)]);
  const icon = o.icon ? new Uint8Array(readFileSync(o.icon)) : new TextEncoder().encode(DEFAULT_ICON);
  const svg = o.icon ? /\.svg$/i.test(o.icon) : true;
  const copyApp = (to: string) => {
    mkdirSync(to, { recursive: true });
    copyFileSync(exe, join(to, o.slug));
    copyFileSync(join(app, core), join(to, core));
    chmodSync(join(to, o.slug), 0o755);
  };
  const made: string[] = [];

  if (formats.includes("deb")) {
    const root = join(stage, "deb");
    copyApp(join(root, "opt", o.slug));
    mkdirSync(join(root, "usr", "bin"), { recursive: true });
    writeFileSync(join(root, "usr", "bin", o.slug), `#!/bin/sh\nexec /opt/${o.slug}/${o.slug} "$@"\n`, { mode: 0o755 });
    const share = join(root, "usr", "share");
    mkdirSync(join(share, "applications"), { recursive: true });
    writeFileSync(join(share, "applications", `${o.slug}.desktop`), desktopEntry(o, `/usr/bin/${o.slug}`));
    writeIcons(share, o.slug, icon, svg);
    mkdirSync(join(root, "DEBIAN"), { recursive: true });
    const control: [string, string | undefined][] = [
      ["Package", o.slug],
      ["Version", o.version],
      ["Architecture", arch.deb],
      ["Maintainer", line(o.maintainer ?? `${o.name} <noreply@localhost>`)],
      ["Installed-Size", String(Math.ceil(sizeOf(root) / 1024))],
      ["Depends", (o.depends ?? DEPENDS).join(", ")],
      ["Recommends", (o.recommends ?? RECOMMENDS).join(", ") || undefined],
      ["Section", "misc"],
      ["Priority", "optional"],
      ["Homepage", o.homepage],
      ["Description", `${line(o.description ?? o.name)}\n ${line(o.name)}, made with Mantou.`],
    ];
    writeFileSync(join(root, "DEBIAN", "control"), control.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n");
    const out = join(outDir, `${o.slug}_${o.version}_${arch.deb}.deb`);
    makeDeb(root, out);
    made.push(out);
  }

  if (formats.includes("tar")) {
    const top = `${o.slug}-${o.version}-linux-${arch.tar}`;
    const dir = join(stage, "tar", top);
    copyApp(join(dir, "app"));
    const share = join(dir, "share");
    mkdirSync(join(share, "applications"), { recursive: true });
    writeFileSync(join(share, "applications", `${o.slug}.desktop`), desktopEntry(o, "@EXEC@"));
    writeIcons(share, o.slug, icon, svg);
    const icons = [...ICON_SIZES.map((s) => `${s}x${s}/apps/${o.slug}.png`), ...(svg ? [`scalable/apps/${o.slug}.svg`] : [])];
    writeFileSync(join(dir, "install.sh"), `#!/bin/sh
# Installs ${line(o.name)} for this user (into ~/.local), or for everyone: sudo PREFIX=/usr/local ./install.sh
set -e
PREFIX="\${PREFIX:-$HOME/.local}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$PREFIX/lib/${o.slug}" "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons"
cp -R "$HERE/app/." "$PREFIX/lib/${o.slug}/"
printf '#!/bin/sh\\nexec "%s/lib/${o.slug}/${o.slug}" "$@"\\n' "$PREFIX" > "$PREFIX/bin/${o.slug}"
chmod 755 "$PREFIX/bin/${o.slug}"
sed "s|@EXEC@|$PREFIX/bin/${o.slug}|" "$HERE/share/applications/${o.slug}.desktop" > "$PREFIX/share/applications/${o.slug}.desktop"
cp -R "$HERE/share/icons/." "$PREFIX/share/icons/"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
echo "Installed ${line(o.name)}: $PREFIX/bin/${o.slug}"
`, { mode: 0o755 });
    writeFileSync(join(dir, "uninstall.sh"), `#!/bin/sh
# Removes what install.sh installed (the same PREFIX: ~/.local by default).
PREFIX="\${PREFIX:-$HOME/.local}"
rm -rf "$PREFIX/lib/${o.slug}"
rm -f "$PREFIX/bin/${o.slug}" "$PREFIX/share/applications/${o.slug}.desktop"
${icons.map((i) => `rm -f "$PREFIX/share/icons/hicolor/${i}"`).join("\n")}
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
echo "Removed ${line(o.name)} from $PREFIX"
`, { mode: 0o755 });
    const out = join(outDir, `${top}.tar.gz`);
    run(["tar", "-czf", out, "--owner=0", "--group=0", "--numeric-owner", "-C", join(stage, "tar"), top]);
    made.push(out);
  }

  if (formats.includes("appimage")) {
    const dir = join(stage, `${o.slug}.AppDir`);
    copyApp(join(dir, "usr", "lib", o.slug));
    writeFileSync(join(dir, "AppRun"), `#!/bin/sh\nHERE="$(dirname "$(readlink -f "$0")")"\nexec "$HERE/usr/lib/${o.slug}/${o.slug}" "$@"\n`, { mode: 0o755 });
    const share = join(dir, "usr", "share");
    mkdirSync(join(share, "applications"), { recursive: true });
    const entry = desktopEntry(o, o.slug);
    writeFileSync(join(share, "applications", `${o.slug}.desktop`), entry);
    writeFileSync(join(dir, `${o.slug}.desktop`), entry);
    const png = writeIcons(share, o.slug, icon, svg);
    writeFileSync(join(dir, `${o.slug}.png`), png);
    symlinkSync(`${o.slug}.png`, join(dir, ".DirIcon"));
    const out = join(outDir, `${o.slug}-${o.version}-${arch.appimage}.AppImage`);
    rmSync(out, { force: true });
    await makeAppImage(dir, out, arch.appimage);
    made.push(out);
  }

  rmSync(stage, { recursive: true, force: true });
  return made;
}

/** What `mantou package` reads from package.json's "mantou" block (flags win). */
export interface PackageConfig {
  name?: string;
  id?: string;
  icon?: string;
  description?: string;
  homepage?: string;
  windows?: Pick<WindowsPackageOptions, "scope" | "publisher" | "protocols" | "desktopShortcut" | "sign"> & { format?: string };
  linux?: Partial<Pick<LinuxPackageOptions, "formats" | "categories" | "keywords" | "maintainer" | "depends" | "recommends" | "slug">>;
}

/** The "mantou" block and version of the package.json in `dir`, if any. */
export function readConfig(dir: string): { config: PackageConfig; version?: string; description?: string; homepage?: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { config: pkg.mantou ?? {}, version: pkg.version, description: pkg.description, homepage: pkg.homepage };
  } catch {
    return { config: {} };
  }
}

