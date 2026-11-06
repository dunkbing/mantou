// The Windows installer's script, icon and signing arguments (dunkbing/mantou#82); they run on every OS. The
// install, launch and uninstall run on a Windows runner: scripts/package-smoke-windows.ts.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ICON, readConfig } from "./package-linux";
import { fileNameOf, findMakensis, makeIco, nsisScript, signArgs, versionQuad, type InstallerInput } from "./package-windows";

const input: InstallerInput = {
  name: "Mantou Mail",
  exe: "Mantou Mail.exe",
  version: "1.2.0",
  id: "dev.dunkbing.mantoumail",
  publisher: "binh.buidang",
  scope: "user",
  protocols: [],
  desktopShortcut: false,
  exePath: "C:\\stage\\Mantou Mail.exe",
  dllPath: "C:\\stage\\mantou_ffi.dll",
  icoPath: "C:\\stage\\app.ico",
  outFile: "C:\\out\\setup.exe",
  sizeKb: 1234,
};

test("versions become four numbers", () => {
  expect(versionQuad("1.2.0")).toBe("1.2.0.0");
  expect(versionQuad("1.2.3-beta.1")).toBe("1.2.3.0");
  expect(versionQuad("2")).toBe("2.0.0.0");
  expect(versionQuad("nightly")).toBe("0.0.0.0");
});

test("file names lose what Windows forbids", () => {
  expect(fileNameOf('A:b/c*"d')).toBe("Abcd");
});

test("a per-user installer: no admin, the user's programs folder, an Apps & features entry", () => {
  const s = nsisScript(input);
  expect(s).toContain("RequestExecutionLevel user");
  expect(s).toContain('InstallDir "$LOCALAPPDATA\\Programs\\Mantou Mail"');
  expect(s).toContain("SetShellVarContext current");
  expect(s).toContain('WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\dev.dunkbing.mantoumail" "DisplayVersion" "1.2.0"');
  expect(s).toContain('"Publisher" "binh.buidang"');
  expect(s).toContain('"QuietUninstallString" "$\\"$INSTDIR\\uninstall.exe$\\" /S"');
  expect(s).toContain('CreateShortcut "$SMPROGRAMS\\Mantou Mail.lnk"');
  expect(s).not.toContain("$DESKTOP\\Mantou Mail.lnk\" \"$INSTDIR"); // no desktop shortcut unless asked
  expect(s).not.toContain("RegisteredApplications\" \"dev"); // no protocols
  expect(s).toContain('VIProductVersion "1.2.0.0"');
  expect(s).toContain('File "C:\\stage\\mantou_ffi.dll"');
  expect(s).toContain("Rename"); // a running app is moved aside on upgrade
  expect(s).toContain("RMDir $INSTDIR"); // never a recursive delete: the user's files stay
  expect(s).not.toContain("RMDir /r");
});

test("a per-machine installer asks for admin and writes HKLM", () => {
  const s = nsisScript({ ...input, scope: "machine", desktopShortcut: true });
  expect(s).toContain("RequestExecutionLevel admin");
  expect(s).toContain('InstallDir "$PROGRAMFILES64\\Mantou Mail"');
  expect(s).toContain("SetShellVarContext all");
  expect(s).toContain("WriteRegStr HKLM");
  expect(s).not.toContain("HKCU");
  expect(s).toContain('CreateShortcut "$DESKTOP\\Mantou Mail.lnk"');
});

test("mailto registers the app as a mail client", () => {
  const s = nsisScript({ ...input, protocols: ["mailto"] });
  expect(s).toContain('"Software\\Clients\\Mail\\Mantou Mail\\Capabilities\\URLAssociations" "mailto" "dev.dunkbing.mantoumail.mailto"');
  expect(s).toContain('"Software\\Classes\\dev.dunkbing.mantoumail.mailto\\shell\\open\\command" "" "$\\"$INSTDIR\\Mantou Mail.exe$\\" $\\"%1$\\""');
  expect(s).toContain('"Software\\RegisteredApplications" "dev.dunkbing.mantoumail" "Software\\Clients\\Mail\\Mantou Mail\\Capabilities"');
  expect(s).toContain('DeleteRegKey HKCU "Software\\Classes\\dev.dunkbing.mantoumail.mailto"');
  expect(s).toContain('DeleteRegValue HKCU "Software\\RegisteredApplications" "dev.dunkbing.mantoumail"');
});

test("other schemes go under the app's own key", () => {
  const s = nsisScript({ ...input, protocols: ["myapp"] });
  expect(s).toContain('"Software\\dev.dunkbing.mantoumail\\Capabilities\\URLAssociations" "myapp"');
  expect(s).not.toContain("Clients\\Mail");
});

test("names with $ and quotes can't break the script", () => {
  const s = nsisScript({ ...input, name: 'A $PLUGINSDIR "x"', publisher: "P$" });
  expect(s).toContain('Name "A $$PLUGINSDIR $\\"x$\\""');
  expect(s).toContain('"Publisher" "P$$"');
});

test("signing arguments: thumbprint, pfx, or custom, always timestamped", () => {
  expect(signArgs({ thumbprint: "AB CD" }, "x.exe")).toEqual(["sign", "/fd", "sha256", "/tr", "http://timestamp.digicert.com", "/td", "sha256", "/sha1", "ABCD", "x.exe"]);
  expect(signArgs({ pfx: "c.pfx", password: "pw", timestamp: "http://t" }, "x.exe")).toEqual(["sign", "/fd", "sha256", "/tr", "http://t", "/td", "sha256", "/f", "c.pfx", "/p", "pw", "x.exe"]);
  expect(signArgs({ args: ["/dlib", "d.dll"] }, "x.exe").slice(-3)).toEqual(["/dlib", "d.dll", "x.exe"]);
  expect(() => signArgs({}, "x.exe")).toThrow("thumbprint");
});

test("the windows block of package.json is read", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-winconf-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0", mantou: { windows: { format: "nsis", scope: "user", publisher: "P", protocols: ["mailto"] } } }));
    expect(readConfig(dir).config.windows).toEqual({ format: "nsis", scope: "user", publisher: "P", protocols: ["mailto"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// With makensis installed (any OS), the generated script must compile.
test.skipIf(!findMakensis())("makensis compiles the script", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-nsis-"));
  try {
    const ico = join(dir, "app.ico");
    writeFileSync(ico, makeIco(new TextEncoder().encode(DEFAULT_ICON)));
    const small = join(dir, "installer.ico");
    writeFileSync(small, makeIco(new TextEncoder().encode(DEFAULT_ICON), [16, 32, 48]));
    writeFileSync(join(dir, "a.exe"), "x");
    writeFileSync(join(dir, "mantou_ffi.dll"), "x");
    const out = join(dir, "mantou-1.2.0-x64.exe");
    const nsi = join(dir, "i.nsi");
    writeFileSync(nsi, nsisScript({ ...input, protocols: ["mailto"], desktopShortcut: true, exePath: join(dir, "a.exe"), dllPath: join(dir, "mantou_ffi.dll"), icoPath: ico, installerIcoPath: small, outFile: out }));
    const p = Bun.spawnSync([findMakensis()!, "-V2", nsi]);
    expect(p.stderr.toString()).toBe("");
    expect(p.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
