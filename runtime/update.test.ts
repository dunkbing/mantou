// Auto-update (dunkbing/mantou#60): the feed, version order, checksum and signature checks, and the apply steps
// with fakes for the OS. The POSIX swap script runs for real (it only needs /bin/sh). Not covered here: a real
// install on each OS (hdiutil mounts, the NSIS installer, an AppImage relaunch).
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, cmdScript, compareVersions, installFor, parseFeed, platformKey, signAsset, unixScript, UpdateError, verifySignature, type UpdateDeps } from "./update";

const sha = (b: string) => createHash("sha256").update(b).digest("hex");
const BODY = "pretend this is an installer";

function feed(over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) {
  return JSON.stringify({ version: "1.2.0", notes: "fixes", platforms: { "linux-x64": { url: "https://x.test/app-1.2.0.AppImage", sha256: sha(BODY), ...asset } }, ...over });
}

function deps(over: Partial<UpdateDeps> = {}, feedText = feed(), body = BODY): { d: Partial<UpdateDeps>; log: string[] } {
  const log: string[] = [];
  const d: Partial<UpdateDeps> = {
    fetch: async (u) => {
      if (u.endsWith("latest.json")) return new Response(feedText);
      const half = Math.floor(body.length / 2);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body.slice(0, half))); c.enqueue(new TextEncoder().encode(body.slice(half))); c.close(); } }), { headers: { "content-length": String(body.length) } });
    },
    platform: "linux",
    arch: "x64",
    pid: 4242,
    env: {},
    detach: (c) => void log.push(`detach ${c.join(" ")}`),
    quit: () => void log.push("quit"),
    run: async (c) => void log.push(`run ${c.join(" ")}`),
    ...over,
  };
  return { d, log };
}

const url = "https://x.test/latest.json";

test("a feed is checked for its shape", () => {
  expect(parseFeed(feed()).platforms["linux-x64"].sha256).toBe(sha(BODY));
  expect(() => parseFeed("{")).toThrow(UpdateError);
  expect(() => parseFeed(feed({ version: "soon" }))).toThrow('no valid "version"');
  expect(() => parseFeed(feed({}, { sha256: "abc" }))).toThrow("64-digit");
  expect(() => parseFeed(JSON.stringify({ version: "1.0.0" }))).toThrow('no "platforms"');
});

test("versions compare as semver", () => {
  expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
  expect(compareVersions("1.0.0-1", "1.0.0-a")).toBeLessThan(0);
  expect(() => compareVersions("x", "1.0.0")).toThrow(UpdateError);
  expect(platformKey("win32", "x64")).toBe("windows-x64");
});

test("only a newer version with a build for this platform is an update", async () => {
  expect((await checkForUpdate({ url, version: "1.2.0", deps: deps().d }))).toBeNull();
  expect((await checkForUpdate({ url, version: "2.0.0", deps: deps().d }))).toBeNull();
  expect(await checkForUpdate({ url, version: "1.0.0", deps: deps({ platform: "darwin", arch: "arm64" }).d })).toBeNull();
  const u = await checkForUpdate({ url, version: "1.0.0", deps: deps().d });
  expect(u?.version).toBe("1.2.0");
  expect(u?.notes).toBe("fixes");
  expect(u?.canInstall).toBe(false); // not running as an AppImage
  const bad = deps({ fetch: async () => new Response("no", { status: 404 }) });
  await expect(checkForUpdate({ url, version: "1.0.0", deps: bad.d })).rejects.toThrow("HTTP 404");
});

test("download reports progress and checks the hash", async () => {
  const u = (await checkForUpdate({ url, version: "1.0.0", deps: deps().d }))!;
  const seen: number[] = [];
  const f = await u.download({ onProgress: (n, t) => void seen.push(n, t) });
  expect(readFileSync(f, "utf8")).toBe(BODY);
  expect(seen.at(-2)).toBe(BODY.length);
  expect(seen.at(-1)).toBe(BODY.length);
  rmSync(join(f, ".."), { recursive: true });

  const wrong = deps({}, feed({}, { sha256: sha("other") }));
  const w = (await checkForUpdate({ url, version: "1.0.0", deps: wrong.d }))!;
  await expect(w.download()).rejects.toThrow("checksum");
});

test("a pinned public key demands a valid signature", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const sig = await signAsset(sha(BODY), priv);
  expect(verifySignature(sha(BODY), sig, pub)).toBe(true);
  expect(verifySignature(sha("other"), sig, pub)).toBe(false);
  expect(verifySignature(sha(BODY), sig, "junk")).toBe(false);
  const der = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  expect(verifySignature(sha(BODY), sig, der)).toBe(true);

  const signed = deps({}, feed({}, { signature: sig }));
  const ok = (await checkForUpdate({ url, version: "1.0.0", publicKey: pub, deps: signed.d }))!;
  rmSync(join(await ok.download(), ".."), { recursive: true });
  const unsigned = (await checkForUpdate({ url, version: "1.0.0", publicKey: pub, deps: deps().d }))!;
  await expect(unsigned.download()).rejects.toThrow("signature");
});

test("what applies where", () => {
  expect(installFor("darwin", "https://x/App-1.dmg", "/Applications/My App.app/Contents/MacOS/app", {})).toEqual({ kind: "dmg", target: "/Applications/My App.app" });
  expect(installFor("darwin", "https://x/App.dmg", "/tmp/dev/app", {})).toEqual({ kind: "manual" });
  expect(installFor("linux", "https://x/a.AppImage", "/x", { APPIMAGE: "/h/a.AppImage" })).toEqual({ kind: "appimage", target: "/h/a.AppImage" });
  expect(installFor("linux", "https://x/a.deb", "/x", { APPIMAGE: "/h/a.AppImage" })).toEqual({ kind: "manual" });
  expect(installFor("win32", "https://x/setup.exe?token=1", "C:\\a.exe", {})).toEqual({ kind: "nsis" });
});

test("an AppImage update is staged next to the app, then a script swaps it after the quit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-upd-"));
  try {
    const target = join(dir, "app.AppImage");
    writeFileSync(target, "old");
    const { d, log } = deps({ env: { APPIMAGE: target }, tmp: () => mkdtempSync(join(dir, "w-")) });
    const u = (await checkForUpdate({ url, version: "1.0.0", deps: d }))!;
    expect(u.canInstall).toBe(true);
    expect(await u.install()).toBe("restarting");
    expect(readFileSync(target, "utf8")).toBe("old"); // nothing swapped yet
    expect(readFileSync(join(dir, ".app.AppImage.update"), "utf8")).toBe(BODY);
    expect(log[0]).toMatch(/^detach \/bin\/sh .*update\.sh$/);
    expect(log[1]).toBe("quit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a build that fails its checksum never reaches the app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-upd-"));
  try {
    const target = join(dir, "app.AppImage");
    writeFileSync(target, "old");
    const { d, log } = deps({ env: { APPIMAGE: target }, tmp: () => mkdtempSync(join(dir, "w-")) }, feed({}, { sha256: sha("other") }));
    const u = (await checkForUpdate({ url, version: "1.0.0", deps: d }))!;
    await expect(u.install()).rejects.toThrow("checksum");
    expect(log).toEqual([]);
    expect(readdirNames(dir)).toEqual(["app.AppImage"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a macOS update that isn't an app is refused before the quit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-upd-"));
  try {
    const app = join(dir, "My App.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    const f = JSON.stringify({ version: "2.0.0", platforms: { "darwin-arm64": { url: "https://x/a.zip", sha256: sha(BODY) } } });
    const { d, log } = deps({ platform: "darwin", arch: "arm64", tmp: () => mkdtempSync(join(dir, "w-")), execPath: join(app, "Contents", "MacOS", "app"), run: async (c) => void (c[1] === "-x" && mkdirSync(join(c[4], "X.app"), { recursive: true }))
    }, f);
    const u = (await checkForUpdate({ url, version: "1.0.0", deps: d }))!;
    await expect(u.install()).rejects.toThrow("isn't an app bundle");
    expect(log).toEqual([]);
    expect(existsSync(join(dir, ".My App.app.update"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readdirNames(dir: string) {
  return [...new Bun.Glob("*").scanSync({ cwd: dir, dot: true, onlyFiles: false })].sort();
}

test("the swap script replaces the app once the old process is gone, and puts the old one back if the swap fails", async () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "mantou-upd-"));
  try {
    const dead = Bun.spawn(["true"]);
    await dead.exited;
    const run = async (name: string, staged: string) => {
      const target = join(dir, name);
      writeFileSync(target, "old");
      const marker = join(dir, `${name}.relaunched`);
      const script = join(mkdtempSync(join(dir, "s-")), "update.sh"); // the script removes its own folder
      writeFileSync(script, unixScript(dead.pid, target, staged, ["touch", marker]));
      const p = Bun.spawn(["/bin/sh", script]);
      await p.exited;
      return { target, marker };
    };
    const good = join(dir, "good.staged");
    writeFileSync(good, "new");
    const a = await run("a", good);
    expect(readFileSync(a.target, "utf8")).toBe("new");
    expect(existsSync(`${a.target}.old`)).toBe(false);
    expect(existsSync(a.marker)).toBe(true);

    // The staged copy is gone (a failed swap): the old app stays and is started again.
    const b = await run("b", join(dir, "missing.staged"));
    expect(readFileSync(b.target, "utf8")).toBe("old");
    expect(existsSync(`${b.target}.old`)).toBe(false);
    expect(existsSync(b.marker)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Windows script waits for the app, runs the installer silently, then starts the app", () => {
  const s = cmdScript(77, "C:\\Temp\\setup.exe", "C:\\Apps\\My App\\app.exe");
  expect(s).toContain('PID eq 77');
  expect(s.indexOf('"C:\\Temp\\setup.exe" /S')).toBeLessThan(s.indexOf('start "" "C:\\Apps\\My App\\app.exe"'));
});

test("the feed beside the artifacts: hashes, signed, merged by platform", async () => {
  const { writeFeed, pickArtifact } = await import("./update-feed");
  const dir = mkdtempSync(join(tmpdir(), "mantou-feed-"));
  try {
    expect(pickArtifact(["a.deb", "a.AppImage", "a.tar.gz"], "linux")).toBe("a.AppImage");
    expect(pickArtifact(["a.tar.gz", "a.deb"], "linux")).toBe("a.deb");
    expect(pickArtifact(["App.app", "App.dmg"], "darwin")).toBe("App.dmg");
    const dmg = join(dir, "My App-1.0.0.dmg");
    const exe = join(dir, "setup.exe");
    writeFileSync(dmg, "dmg");
    writeFileSync(exe, "exe");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await writeFeed(dir, [dmg], { version: "1.0.0", baseUrl: "https://h.test/dl/", platform: "darwin", arch: "arm64", signingKey: key, notes: "n" });
    const path = await writeFeed(dir, [exe], { version: "1.0.0", baseUrl: "https://h.test/dl", platform: "win32", arch: "x64" });
    const f = parseFeed(readFileSync(path, "utf8"));
    expect(Object.keys(f.platforms).sort()).toEqual(["darwin-arm64", "windows-x64"]);
    expect(f.notes).toBe("n");
    expect(f.platforms["darwin-arm64"].url).toBe("https://h.test/dl/My%20App-1.0.0.dmg");
    expect(f.platforms["darwin-arm64"].sha256).toBe(sha("dmg"));
    expect(verifySignature(sha("dmg"), f.platforms["darwin-arm64"].signature!, publicKey.export({ type: "spki", format: "pem" }).toString())).toBe(true);
    await writeFeed(dir, [exe], { version: "1.1.0", baseUrl: "https://h.test/dl", platform: "win32", arch: "x64" });
    expect(Object.keys(parseFeed(readFileSync(path, "utf8")).platforms)).toEqual(["windows-x64"]); // a new version starts over
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
