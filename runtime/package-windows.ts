// `mantou package` on Windows (dunkbing/mantou#82): the app built with `mantou build` (icon and version resource
// embedded by Bun's compiler), then an NSIS installer: per user by default, a Start menu shortcut, an Apps &
// features entry, upgrade in place, optional Authenticode signing and protocol registration.
//
// NSIS rather than WiX: `makensis` is one small program (choco `nsis` on Windows runners, a package on Linux and
// macOS), it takes a text script, and the installer can be silent (`/S`). WiX needs its .NET toolset and makes an
// .msi, whose per-user installs and "never needs admin" story are harder to get right.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { build } from "./build";
import { libPath } from "./ffi";
import { encodePng, renderImage, type Image } from "./png";
import { DEFAULT_ICON, slugOf } from "./package-linux";

export interface WindowsSign {
  /** A certificate in the store, by SHA-1 thumbprint. */
  thumbprint?: string;
  /** A .pfx file (its password from `password`, or the MANTOU_SIGN_PASSWORD variable). */
  pfx?: string;
  password?: string;
  /** Extra signtool arguments instead, for a cloud signer such as Azure Trusted Signing (`/dlib …`, `/dmdf …`). */
  args?: string[];
  /** The RFC 3161 timestamp server (default: http://timestamp.digicert.com). */
  timestamp?: string;
}

export interface WindowsPackageOptions {
  /** The app's name as people see it ("Mantou Mail"). */
  name: string;
  version: string;
  /** Reverse-DNS id: the uninstall entry's key and the protocol handlers' ProgIDs. */
  id?: string;
  description?: string;
  /** An SVG or a large PNG; without one, a plain default icon. */
  icon?: string;
  /** The publisher shown in Apps & features, SmartScreen and the file's properties. */
  publisher?: string;
  /** "user" (default): %LOCALAPPDATA%\Programs, no admin; "machine": Program Files, asks for admin. */
  scope?: "user" | "machine";
  /** URL schemes to register the app for ("mailto"). */
  protocols?: string[];
  /** A desktop shortcut too. */
  desktopShortcut?: boolean;
  sign?: WindowsSign;
}

export interface InstallerInput {
  name: string;
  /** The executable's file name ("Mantou Mail.exe"). */
  exe: string;
  version: string;
  id: string;
  publisher: string;
  scope: "user" | "machine";
  protocols: string[];
  desktopShortcut: boolean;
  /** Absolute paths of the files to pack. */
  exePath: string;
  dllPath: string;
  icoPath: string;
  installerIcoPath?: string;
  /** Where to write the installer. */
  outFile: string;
  /** Size of the installed files in KiB (Apps & features shows it). */
  sizeKb: number;
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const INSTALLER_ICO_SIZES = [16, 32, 48];
const TIMESTAMP = "http://timestamp.digicert.com";

/** "1.2.0-beta.1" → "1.2.0.0": the four numbers of a Windows version. */
export function versionQuad(v: string): string {
  const nums = (v.match(/^\d+(?:\.\d+){0,3}/)?.[0] ?? "0").split(".").map((n) => Math.min(Number(n), 65535));
  while (nums.length < 4) nums.push(0);
  return nums.join(".");
}

/** An .ico of `icon` (SVG or PNG) at each size: PNG-compressed from 64 px up, plain bitmaps below (what old readers want). */
export function makeIco(icon: Uint8Array, sizes: number[] = ICO_SIZES): Uint8Array {
  const entries = sizes.map((size) => ({ size, data: size >= 64 ? encodePng(renderImage(icon, size, size)) : bitmapEntry(renderImage(icon, size, size)) }));
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const at = 6 + 16 * i;
    head[at] = e.size >= 256 ? 0 : e.size;
    head[at + 1] = e.size >= 256 ? 0 : e.size;
    head.writeUInt16LE(1, at + 4); // planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(e.data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

/** A 32-bit DIB for an .ico entry: BGRA rows bottom-up, then an (unused) AND mask. */
function bitmapEntry(img: Image): Uint8Array {
  const { width: w, height: h, pixels } = img;
  const mask = Math.ceil(w / 32) * 4 * h;
  const out = Buffer.alloc(40 + w * h * 4 + mask);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(w, 4);
  out.writeInt32LE(h * 2, 8); // the image and its mask
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4;
      const d = 40 + (y * w + x) * 4;
      out[d] = pixels[s + 2];
      out[d + 1] = pixels[s + 1];
      out[d + 2] = pixels[s];
      out[d + 3] = pixels[s + 3];
    }
  return out;
}

/** Escapes text for inside an NSIS string ("$" and quotes; one line). */
const e = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\$/g, "$$$$").replace(/"/g, "$\\\"");
const q = (escaped: string) => `"${escaped}"`;
/** A file name that Windows allows. */
export const fileNameOf = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "app";

/** The NSIS script for the installer (pure: the tests read it). */
export function nsisScript(i: InstallerInput): string {
  const user = i.scope === "user";
  const hive = user ? "HKCU" : "HKLM";
  const name = e(i.name);
  const id = e(i.id);
  const inst = (f: string) => `$INSTDIR\\${e(f)}`;
  const quoted = (s: string) => `$\\"${s}$\\"`; // a quoted path inside a string
  const uninstKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}`;
  const appKey = `Software\\${id}`;
  const mail = i.protocols.includes("mailto");
  const capKey = mail ? `Software\\Clients\\Mail\\${name}\\Capabilities` : `${appKey}\\Capabilities`;
  const L: string[] = [];
  const add = (...s: string[]) => L.push(...s);
  const reg = (key: string, valueName: string, value: string) => add(`  WriteRegStr ${hive} ${q(key)} ${q(valueName)} ${q(value)}`);

  add(
    "Unicode true",
    "SetCompressor /SOLID lzma",
    `Name ${q(name)}`,
    `OutFile ${q(e(i.outFile))}`,
    `InstallDir ${q(user ? `$LOCALAPPDATA\\Programs\\${name}` : `$PROGRAMFILES64\\${name}`)}`,
    // An upgrade goes to where the app is (read in the 32-bit view, where the install below writes it).
    `InstallDirRegKey ${hive} ${q(appKey)} "InstallDir"`,
    `RequestExecutionLevel ${user ? "user" : "admin"}`,
    "ShowInstDetails nevershow",
    "ShowUninstDetails nevershow",
    `BrandingText ${q(`${name} ${e(i.version)}`)}`,
    `VIProductVersion ${q(versionQuad(i.version))}`,
    `VIFileVersion ${q(versionQuad(i.version))}`,
    `VIAddVersionKey "ProductName" ${q(name)}`,
    `VIAddVersionKey "ProductVersion" ${q(e(i.version))}`,
    `VIAddVersionKey "FileVersion" ${q(e(i.version))}`,
    `VIAddVersionKey "CompanyName" ${q(e(i.publisher))}`,
    `VIAddVersionKey "FileDescription" ${q(`${name} setup`)}`,
    `VIAddVersionKey "LegalCopyright" ${q(e(i.publisher))}`,
  );
  if (i.installerIcoPath) add(`Icon ${q(e(i.installerIcoPath))}`, `UninstallIcon ${q(e(i.installerIcoPath))}`);
  add("", "Page directory", "Page instfiles", "UninstPage uninstConfirm", "UninstPage instfiles", "");

  const exe = inst(i.exe);
  add(
    'Section "Install"',
    `  SetShellVarContext ${user ? "current" : "all"}`,
    "  SetOutPath $INSTDIR",
    // A running app (or its core) can be renamed but not overwritten: move it aside, drop the old file later.
    "  ClearErrors",
    `  Rename ${q(exe)} ${q(exe + ".old")}`,
    `  Rename ${q(inst("mantou_ffi.dll"))} ${q(inst("mantou_ffi.dll.old"))}`,
    "  ClearErrors",
    `  File ${q(e(i.exePath))}`,
    `  File ${q(e(i.dllPath))}`,
    `  File "/oname=app.ico" ${q(e(i.icoPath))}`,
    `  Delete /REBOOTOK ${q(exe + ".old")}`,
    `  Delete /REBOOTOK ${q(inst("mantou_ffi.dll.old"))}`,
    `  WriteUninstaller ${q(inst("uninstall.exe"))}`,
    `  WriteRegStr ${hive} ${q(appKey)} "InstallDir" $INSTDIR`,
    "  SetRegView 64",
    `  CreateShortcut ${q(`$SMPROGRAMS\\${name}.lnk`)} ${q(exe)} "" ${q(exe)} 0`,
  );
  if (i.desktopShortcut) add(`  CreateShortcut ${q(`$DESKTOP\\${name}.lnk`)} ${q(exe)} "" ${q(exe)} 0`);
  reg(uninstKey, "DisplayName", name);
  reg(uninstKey, "DisplayVersion", e(i.version));
  reg(uninstKey, "Publisher", e(i.publisher));
  reg(uninstKey, "DisplayIcon", exe);
  reg(uninstKey, "InstallLocation", "$INSTDIR");
  reg(uninstKey, "UninstallString", quoted(inst("uninstall.exe")));
  reg(uninstKey, "QuietUninstallString", quoted(inst("uninstall.exe")) + " /S");
  add(
    `  WriteRegDWORD ${hive} ${q(uninstKey)} "NoModify" 1`,
    `  WriteRegDWORD ${hive} ${q(uninstKey)} "NoRepair" 1`,
    `  WriteRegDWORD ${hive} ${q(uninstKey)} "EstimatedSize" ${Math.max(0, Math.floor(i.sizeKb))}`,
  );
  if (i.protocols.length) {
    reg(capKey, "ApplicationName", name);
    reg(capKey, "ApplicationDescription", name);
    reg("Software\\RegisteredApplications", id, capKey);
    if (mail) {
      reg(`Software\\Clients\\Mail\\${name}`, "", name);
      reg(`Software\\Clients\\Mail\\${name}\\shell\\open\\command`, "", quoted(exe));
    }
    for (const p of i.protocols) {
      const prog = `${id}.${e(p)}`;
      reg(`Software\\Classes\\${prog}`, "", `URL:${e(p)}`);
      reg(`Software\\Classes\\${prog}`, "URL Protocol", "");
      reg(`Software\\Classes\\${prog}\\DefaultIcon`, "", quoted(exe) + ",0");
      reg(`Software\\Classes\\${prog}\\shell\\open\\command`, "", `${quoted(exe)} ${quoted("%1")}`);
      reg(`${capKey}\\URLAssociations`, e(p), prog);
    }
  }
  add("SectionEnd", "");

  add(
    'Section "Uninstall"',
    `  SetShellVarContext ${user ? "current" : "all"}`,
    // The files we installed, not the folder's other contents; the app's data under %APPDATA% stays.
    ...[i.exe, `${i.exe}.old`, "mantou_ffi.dll", "mantou_ffi.dll.old", "app.ico", "uninstall.exe"].map((f) => `  Delete ${q(inst(f))}`),
    "  RMDir $INSTDIR",
    `  Delete ${q(`$SMPROGRAMS\\${name}.lnk`)}`,
    `  Delete ${q(`$DESKTOP\\${name}.lnk`)}`,
    `  DeleteRegKey ${hive} ${q(appKey)}`,
    "  SetRegView 64",
    `  DeleteRegKey ${hive} ${q(appKey)}`, // the capabilities of a non-mail app are in this view
    `  DeleteRegKey ${hive} ${q(uninstKey)}`,
  );
  if (i.protocols.length) {
    add(`  DeleteRegValue ${hive} "Software\\RegisteredApplications" ${q(id)}`);
    if (mail) add(`  DeleteRegKey ${hive} ${q(`Software\\Clients\\Mail\\${name}`)}`);
    for (const p of i.protocols) add(`  DeleteRegKey ${hive} ${q(`Software\\Classes\\${id}.${e(p)}`)}`);
  }
  add("SectionEnd", "");
  return L.join("\r\n");
}

function run(cmd: string[], what = cmd[0]) {
  const p = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`mantou: ${what} failed (${p.exitCode})`);
}

/** makensis: MAKENSIS, PATH, or where the Windows installer puts it. */
export function findMakensis(): string | undefined {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  const found = Bun.which("makensis");
  if (found) return found;
  for (const dir of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, "C:\\Program Files (x86)", "C:\\Program Files"]) {
    const p = dir && join(dir, "NSIS", "makensis.exe");
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

/** signtool: SIGNTOOL, PATH, or the newest in the Windows SDK. */
export function findSigntool(): string | undefined {
  if (process.env.SIGNTOOL) return process.env.SIGNTOOL;
  const found = Bun.which("signtool");
  if (found) return found;
  const kits = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (!existsSync(kits)) return undefined;
  const versions = readdirSync(kits).filter((v) => /^\d/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
  for (const v of versions) {
    const p = join(kits, v, process.arch === "arm64" ? "arm64" : "x64", "signtool.exe");
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** The signtool arguments that sign `file` (the password is in the arguments, so they're never printed). */
export function signArgs(s: WindowsSign, file: string): string[] {
  const who = s.args ?? (s.thumbprint ? ["/sha1", s.thumbprint.replace(/\s+/g, "")] : s.pfx ? ["/f", s.pfx, ...((s.password ?? process.env.MANTOU_SIGN_PASSWORD) ? ["/p", (s.password ?? process.env.MANTOU_SIGN_PASSWORD)!] : [])] : undefined);
  if (!who) throw new Error("mantou package: signing needs a thumbprint, a .pfx, or signtool arguments");
  return ["sign", "/fd", "sha256", "/tr", s.timestamp ?? TIMESTAMP, "/td", "sha256", ...who, file];
}

function signFile(s: WindowsSign, file: string) {
  const tool = findSigntool();
  if (!tool) throw new Error("mantou package: signtool not found (install the Windows SDK, or set SIGNTOOL)");
  run([tool, ...signArgs(s, file)], `signing ${basename(file)}`);
}

function sizeOf(files: string[]) {
  return Math.ceil(files.reduce((n, f) => n + statSync(f).size, 0) / 1024);
}

/** Builds `entry` and its installer into `outDir`. Returns the installer's path. */
export async function packageWindows(entry: string, outDir: string, opts: WindowsPackageOptions): Promise<string[]> {
  if (process.platform !== "win32") throw new Error("mantou package: Windows installers are made on Windows (the app is built with the Windows core)");
  const makensis = findMakensis();
  if (!makensis) throw new Error("mantou package: makensis not found; install NSIS (`choco install nsis`) or set MAKENSIS");
  const slug = slugOf(opts.name);
  const exeName = `${fileNameOf(opts.name)}.exe`;
  const publisher = opts.publisher ?? opts.name;
  outDir = resolve(outDir);
  const stage = join(outDir, `.windows-${slug}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const icon = opts.icon ? new Uint8Array(readFileSync(opts.icon)) : new TextEncoder().encode(DEFAULT_ICON);
  const icoPath = join(stage, "app.ico");
  writeFileSync(icoPath, makeIco(icon));
  const installerIcoPath = join(stage, "installer.ico");
  writeFileSync(installerIcoPath, makeIco(icon, INSTALLER_ICO_SIZES));

  const app = join(stage, "app");
  mkdirSync(app, { recursive: true });
  const exePath = await build(entry, app, exeName, {
    hideConsole: true,
    icon: icoPath,
    title: opts.name,
    publisher,
    version: versionQuad(opts.version),
    description: opts.description ?? opts.name,
    copyright: publisher,
  });
  const dllPath = join(app, basename(libPath()));
  if (opts.sign) for (const f of [exePath, dllPath]) signFile(opts.sign, f);

  const out = join(outDir, `${slug}-${opts.version}-windows-${process.arch}.exe`);
  rmSync(out, { force: true });
  const nsi = join(stage, "installer.nsi");
  writeFileSync(
    nsi,
    nsisScript({
      name: opts.name,
      exe: exeName,
      version: opts.version,
      id: opts.id ?? `com.example.${slug}`,
      publisher,
      scope: opts.scope ?? "user",
      protocols: opts.protocols ?? [],
      desktopShortcut: opts.desktopShortcut ?? false,
      exePath,
      dllPath,
      icoPath,
      installerIcoPath,
      outFile: out,
      sizeKb: sizeOf([exePath, dllPath, icoPath]),
    }),
  );
  run([makensis, "-V2", nsi], "makensis");
  if (!existsSync(out)) throw new Error("mantou package: makensis wrote no installer");
  if (opts.sign) signFile(opts.sign, out);
  rmSync(stage, { recursive: true, force: true });
  return [out];
}
