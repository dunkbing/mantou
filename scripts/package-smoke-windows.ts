// Windows only (CI): `mantou package` the counter, install it silently per user into a temp folder, check the
// files, the Start menu shortcut, the Apps & features entry, the version resource and the mailto registration,
// start the app, install over the running app (an upgrade), uninstall silently and check everything is gone.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageWindows } from "../runtime/package-windows";

const ID = "dev.mantou.smoke";
const NAME = "Mantou Smoke";
const uninstKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${ID}`;
const fail = (m: string): never => {
  console.error(`smoke: ${m}`);
  process.exit(1);
};
const check = (ok: boolean, m: string) => (ok ? console.log(`ok: ${m}`) : fail(m));
const reg = (key: string, value?: string) => Bun.spawnSync(["reg", "query", key, ...(value ? ["/v", value] : [])]);
const powershell = (cmd: string) => Bun.spawnSync(["powershell", "-NoProfile", "-Command", cmd]).stdout.toString().trim();
const until = async (what: string, cond: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) fail(`timed out: ${what}`);
    await Bun.sleep(100);
  }
};

if (process.platform !== "win32") fail("this runs on Windows");
const work = mkdtempSync(join(tmpdir(), "mantou-smoke-"));
const dir = join(work, "Mantou Smoke app");
const lnk = join(process.env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", `${NAME}.lnk`);
try {
  const [installer] = await packageWindows("examples/counter/main.tsx", join(work, "dist"), {
    name: NAME,
    id: ID,
    version: "1.2.0",
    publisher: "Mantou Tests",
    description: "Smoke test",
    protocols: ["mailto"],
  });
  console.log(`built ${installer}`);

  const install = () => Bun.spawnSync([installer, "/S", `/D=${dir}`]).exitCode;
  check(install() === 0, "silent per-user install");
  const exe = join(dir, `${NAME}.exe`);
  for (const f of [`${NAME}.exe`, "mantou_ffi.dll", "uninstall.exe"]) check(existsSync(join(dir, f)), `${f} installed`);
  check(existsSync(lnk), "Start menu shortcut");
  const version = reg(uninstKey, "DisplayVersion").stdout.toString();
  check(version.includes("1.2.0"), "Apps & features: version");
  check(reg(uninstKey, "Publisher").stdout.toString().includes("Mantou Tests"), "Apps & features: publisher");
  check(reg(uninstKey, "DisplayIcon").stdout.toString().includes(`${NAME}.exe`), "Apps & features: icon");
  check(reg(`HKCU\\Software\\Clients\\Mail\\${NAME}\\Capabilities\\URLAssociations`, "mailto").exitCode === 0, "mailto registered");
  const info = JSON.parse(powershell(`(Get-Item '${exe}').VersionInfo | Select-Object ProductName,ProductVersion,FileVersion,CompanyName | ConvertTo-Json`));
  console.log("version resource", info);
  check(String(info.ProductVersion).startsWith("1.2.0") || String(info.FileVersion).startsWith("1.2.0"), "executable's version resource");
  check(String(info.CompanyName) === "Mantou Tests", "executable's publisher");
  const icons = powershell(`Add-Type -AssemblyName System.Drawing; $i = [System.Drawing.Icon]::ExtractAssociatedIcon('${exe}'); "$($i.Width)"`);
  check(Number(icons) > 0, `executable has an icon (${icons} px)`);

  // Start the app and let it run, then install over it while it runs.
  const app = Bun.spawn([exe], { stdio: ["ignore", "ignore", "ignore"] });
  await Bun.sleep(4000);
  check(app.exitCode === null, "the installed app stays up");
  check(install() === 0, "upgrade in place over the running app");
  app.kill();
  await app.exited;
  check(existsSync(exe), "app still installed after the upgrade");

  // Uninstall silently; `_?=` makes the uninstaller run in place and wait.
  check(Bun.spawnSync([join(dir, "uninstall.exe"), "/S", `_?=${dir}`]).exitCode === 0, "silent uninstall");
  for (const f of [`${NAME}.exe`, "mantou_ffi.dll", "app.ico"]) check(!existsSync(join(dir, f)), `${f} removed`);
  check(!existsSync(lnk), "Start menu shortcut removed");
  check(reg(uninstKey).exitCode !== 0, "Apps & features entry removed");
  check(reg(`HKCU\\Software\\Clients\\Mail\\${NAME}`).exitCode !== 0, "mail client entry removed");
  check(reg(`HKCU\\Software\\Classes\\${ID}.mailto`).exitCode !== 0, "mailto handler removed");
  check(reg("HKCU\\Software\\RegisteredApplications", ID).exitCode !== 0, "registered application removed");
  console.log("smoke: ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
