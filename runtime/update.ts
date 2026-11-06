// Auto-update (dunkbing/mantou#60): read a feed (a JSON file the app's author hosts), download the build for this
// platform with progress, check its SHA-256 (and an Ed25519 signature when the app pins a public key), then apply it
// with a small helper script that waits for the app to quit, swaps the files and starts the new version.
// Everything that touches the OS is behind `UpdateDeps`, so the steps run in tests with fakes.
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { win } from "./platform";

/** One downloadable build. `signature` is base64 Ed25519 over the `sha256` hex text (see `signAsset`). */
export interface FeedAsset {
  url: string;
  sha256: string;
  size?: number;
  signature?: string;
}

/** The feed file: the latest version and, per platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`), its build. */
export interface UpdateFeed {
  version: string;
  notes?: string;
  platforms: Record<string, FeedAsset>;
}

export class UpdateError extends Error {}

/** Checks a feed's shape. Throws an `UpdateError` that says what is wrong. */
export function parseFeed(text: string | unknown): UpdateFeed {
  let raw: unknown = text;
  if (typeof text === "string") {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new UpdateError("the update feed isn't valid JSON");
    }
  }
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.version !== "string" || !parseVersion(o.version)) throw new UpdateError('the update feed has no valid "version"');
  const platforms = o.platforms as Record<string, Record<string, unknown>> | undefined;
  if (!platforms || typeof platforms !== "object") throw new UpdateError('the update feed has no "platforms"');
  const out: Record<string, FeedAsset> = {};
  for (const [k, a] of Object.entries(platforms)) {
    if (!a || typeof a.url !== "string" || typeof a.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(a.sha256)) throw new UpdateError(`the update feed's "${k}" needs a url and a 64-digit sha256`);
    out[k] = { url: a.url, sha256: a.sha256.toLowerCase(), ...(typeof a.size === "number" ? { size: a.size } : {}), ...(typeof a.signature === "string" ? { signature: a.signature } : {}) };
  }
  return { version: o.version, ...(typeof o.notes === "string" ? { notes: o.notes } : {}), platforms: out };
}

interface Ver {
  nums: number[];
  pre: string[];
}

function parseVersion(v: string): Ver | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  return m ? { nums: [+m[1], +(m[2] ?? 0), +(m[3] ?? 0)], pre: m[4] ? m[4].split(".") : [] } : null;
}

/** Semver order: negative if a < b, 0 if equal, positive if a > b (a prerelease is below its release). Throws on a bad version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new UpdateError(`not a version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p - +q;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** The feed key of a platform: `darwin-arm64`, `linux-x64`, `windows-x64`. */
export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform === "win32" ? "windows" : platform}-${arch}`;
}

/** The signature a feed carries for an asset: Ed25519 over the SHA-256 hex text, as base64. `privateKeyPem` is a PKCS#8 PEM. */
export async function signAsset(sha256: string, privateKeyPem: string): Promise<string> {
  const { sign, createPrivateKey } = await import("node:crypto");
  return sign(null, Buffer.from(sha256), createPrivateKey(privateKeyPem)).toString("base64");
}

/** Whether `signature` is valid for `sha256` under `publicKey` (a PEM, or the base64 of the SPKI DER). */
export function verifySignature(sha256: string, signature: string, publicKey: string): boolean {
  try {
    const key = publicKey.includes("BEGIN") ? createPublicKey(publicKey) : createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(sha256), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** What to do with a downloaded file on this platform. */
export type Install =
  | { kind: "dmg" | "zip"; target: string } // macOS: replace this .app
  | { kind: "appimage"; target: string } // Linux: replace this AppImage
  | { kind: "nsis" } // Windows: run the installer silently
  | { kind: "manual" }; // anything else: the app shows the link

/** How a build is applied on a platform, from the file's name and where the app runs. */
export function installFor(platform: string, url: string, execPath: string, env: Record<string, string | undefined>): Install {
  const name = new URL(url, "file:///").pathname.toLowerCase();
  if (platform === "darwin") {
    const m = /^(.*?\.app)(\/|$)/.exec(execPath);
    if (m && /\.(dmg|zip)$/.test(name)) return { kind: name.endsWith(".dmg") ? "dmg" : "zip", target: m[1] };
  } else if (platform === "linux") {
    if (env.APPIMAGE && name.endsWith(".appimage")) return { kind: "appimage", target: env.APPIMAGE };
  } else if (platform === "win32" && name.endsWith(".exe")) return { kind: "nsis" };
  return { kind: "manual" };
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const cmdq = (s: string) => `"${s.replace(/"/g, '""').replace(/%/g, "%%")}"`;

/** The POSIX helper that waits for the app (`pid`) to exit, swaps `staged` over `target` (the old one is kept until the swap worked, and put back if it didn't) and runs `relaunch`. */
export function unixScript(pid: number, target: string, staged: string, relaunch: string[]): string {
  const old = `${target}.old`;
  return [
    "#!/bin/sh",
    `i=0; while kill -0 ${pid} 2>/dev/null; do i=$((i+1)); [ $i -gt 120 ] && { rm -rf ${sh(staged)}; exit 1; }; sleep 0.5; done`,
    `rm -rf ${sh(old)}`,
    `mv ${sh(target)} ${sh(old)} || { rm -rf ${sh(staged)}; exit 1; }`,
    `if mv ${sh(staged)} ${sh(target)}; then rm -rf ${sh(old)}; else mv ${sh(old)} ${sh(target)}; fi`,
    'rm -rf "$(dirname "$0")"', // the download and this script
    `exec ${relaunch.map(sh).join(" ")}`,
    "",
  ].join("\n");
}

/** The Windows helper: waits for the app to exit, runs the installer silently (`/S`) and starts the app again. */
export function cmdScript(pid: number, installer: string, exe: string): string {
  return [
    "@echo off",
    "set n=0",
    ":wait",
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
    "if errorlevel 1 goto go",
    "set /a n+=1",
    "if %n% gtr 120 exit /b 1",
    "ping -n 2 127.0.0.1 >nul",
    "goto wait",
    ":go",
    `${cmdq(installer)} /S`,
    `start "" ${cmdq(exe)}`,
    "",
  ].join("\r\n");
}

/** Everything that touches the OS, replaceable in tests. */
export interface UpdateDeps {
  fetch: (url: string) => Promise<Response>;
  platform: string;
  arch: string;
  execPath: string;
  pid: number;
  env: Record<string, string | undefined>;
  tmp: () => string;
  /** Runs a command to completion; throws on a non-zero exit. */
  run: (cmd: string[]) => Promise<void>;
  /** Starts a command that outlives the app. */
  detach: (cmd: string[]) => void;
  quit: () => void;
}

function defaults(): UpdateDeps {
  return {
    fetch: (u) => fetch(u),
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    pid: process.pid,
    env: process.env,
    tmp: () => mkdtempSync(join(tmpdir(), "mantou-update-")),
    run: async (cmd) => {
      const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
      const err = await new Response(p.stderr).text();
      if ((await p.exited) !== 0) throw new UpdateError(`${cmd[0]} failed: ${err.trim()}`);
    },
    detach: (cmd) => spawn(cmd[0], cmd.slice(1), { detached: true, stdio: "ignore" }).unref(),
    quit: () => win.close(),
  };
}

export interface CheckOptions {
  /** The feed's URL. */
  url: string;
  /** The running app's version (from your package.json). */
  version: string;
  /** Ed25519 public key (PEM, or base64 of its SPKI DER): builds must carry a valid signature. */
  publicKey?: string;
  deps?: Partial<UpdateDeps>;
}

export interface InstallOptions {
  onProgress?: (done: number, total: number) => void;
}

/** A newer version found by `checkForUpdate`. */
export class Update {
  readonly version: string;
  readonly notes?: string;
  /** The build's URL: for `canInstall === false`, where the app sends the user. */
  readonly url: string;
  readonly size?: number;
  /** Whether `install()` can apply it by itself here (else show `url` and let the user install it). */
  readonly canInstall: boolean;
  readonly #asset: FeedAsset;
  readonly #how: Install;
  readonly #o: CheckOptions;
  readonly #d: UpdateDeps;

  constructor(feed: UpdateFeed, asset: FeedAsset, o: CheckOptions, d: UpdateDeps) {
    this.version = feed.version;
    this.notes = feed.notes;
    this.url = asset.url;
    this.size = asset.size;
    this.#asset = asset;
    this.#o = o;
    this.#d = d;
    this.#how = installFor(d.platform, asset.url, d.execPath, d.env);
    this.canInstall = this.#how.kind !== "manual";
  }

  /** Downloads the build to a temp file, checking its SHA-256 and signature; the file is deleted if they don't match. Returns its path. */
  async download(opts: InstallOptions = {}): Promise<string> {
    const a = this.#asset;
    if (this.#o.publicKey && (!a.signature || !verifySignature(a.sha256, a.signature, this.#o.publicKey))) throw new UpdateError("the update's signature isn't valid");
    const res = await this.#d.fetch(new URL(a.url, this.#o.url).href);
    if (!res.ok || !res.body) throw new UpdateError(`downloading the update failed: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || a.size || 0;
    const file = join(this.#d.tmp(), basename(new URL(a.url, "file:///").pathname) || "update");
    const hash = createHash("sha256");
    const out = createWriteStream(file);
    let done = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
        done += chunk.length;
        opts.onProgress?.(done, total);
      }
      await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    } catch (e) {
      rmSync(dirname(file), { recursive: true, force: true });
      throw e;
    }
    if (hash.digest("hex") !== a.sha256) {
      rmSync(dirname(file), { recursive: true, force: true });
      throw new UpdateError("the downloaded update doesn't match its checksum");
    }
    return file;
  }

  /**
   * Downloads, verifies and applies the update, then quits the app: a helper starts the new version once this one
   * has exited. All checks and the staging of the new files happen before the quit, so a failure throws and leaves
   * the installed app as it was. Resolves `"manual"` (nothing done) when this platform can't apply the build by itself.
   */
  async install(opts: InstallOptions = {}): Promise<"restarting" | "manual"> {
    const how = this.#how;
    if (how.kind === "manual") return "manual";
    const d = this.#d;
    const file = await this.download(opts);
    const work = dirname(file);
    try {
      let script: string;
      let path: string;
      if (how.kind === "nsis") {
        path = join(work, "update.cmd");
        script = cmdScript(d.pid, file, d.execPath);
      } else {
        const staged = join(dirname(how.target), `.${basename(how.target)}.update`);
        rmSync(staged, { recursive: true, force: true });
        if (how.kind === "appimage") {
          copyFileSync(file, staged);
          chmodSync(staged, 0o755);
        } else await this.#stageApp(how.kind, file, staged, work);
        path = join(work, "update.sh");
        script = unixScript(d.pid, how.target, staged, how.kind === "appimage" ? [how.target] : ["open", how.target]);
      }
      writeFileSync(path, script, { mode: 0o755 });
      d.detach(d.platform === "win32" ? ["cmd", "/c", path] : ["/bin/sh", path]);
    } catch (e) {
      rmSync(work, { recursive: true, force: true });
      throw e;
    }
    d.quit();
    return "restarting";
  }

  async #stageApp(kind: "dmg" | "zip", file: string, staged: string, work: string) {
    const d = this.#d;
    const find = (dir: string) => {
      const app = new Bun.Glob("*.app").scanSync({ cwd: dir, onlyFiles: false })[Symbol.iterator]().next().value as string | undefined;
      if (!app) throw new UpdateError("the update has no .app in it");
      return join(dir, app);
    };
    try {
      if (kind === "zip") {
        const dir = join(work, "x");
        mkdirSync(dir);
        await d.run(["ditto", "-x", "-k", file, dir]);
        renameSync(find(dir), staged);
      } else {
        const mnt = join(work, "mnt");
        mkdirSync(mnt);
        await d.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mnt, file]);
        try {
          await d.run(["ditto", find(mnt), staged]);
        } finally {
          await d.run(["hdiutil", "detach", "-force", mnt]).catch(() => {});
        }
      }
      if (!existsSync(join(staged, "Contents", "Info.plist"))) throw new UpdateError("the update isn't an app bundle");
    } catch (e) {
      rmSync(staged, { recursive: true, force: true });
      throw e;
    }
  }
}

/**
 * Reads the feed and returns the update when it is newer than `version` and has a build for this platform, else null.
 * Throws an `UpdateError` when the feed can't be read or is invalid.
 */
export async function checkForUpdate(o: CheckOptions): Promise<Update | null> {
  const d = { ...defaults(), ...o.deps };
  const res = await d.fetch(o.url);
  if (!res.ok) throw new UpdateError(`the update feed answered HTTP ${res.status}`);
  const feed = parseFeed(await res.text());
  if (compareVersions(feed.version, o.version) <= 0) return null;
  const asset = feed.platforms[platformKey(d.platform, d.arch)];
  return asset ? new Update(feed, asset, o, d) : null;
}
