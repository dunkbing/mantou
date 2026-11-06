// `mantou package` on Linux (dunkbing/mantou#81): the counter as a .deb, a .tar.gz and an AppImage, checked
// inside: the .desktop entry, the icons, the control fields, install.sh and uninstall.sh. (The apps were also
// started from each package in a window under Xvfb, by hand: see progress/shipping.)
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../runtime/png";
import { makeDeb, packageLinux, slugOf } from "../runtime/package-linux";

const linux = process.platform === "linux";
const sh = (cmd: string[], env?: Record<string, string>) => {
  const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env } });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString();
};

test("names become package names", () => {
  expect(slugOf("Mantou Mail")).toBe("mantou-mail");
  expect(slugOf("  Hello, World! 2 ")).toBe("hello-world-2");
  expect(slugOf("X")).toBe("app-x");
});

test.skipIf(!linux || !Bun.which("dpkg-deb"))("a .deb made without dpkg-deb is one dpkg-deb reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-deb-"));
  try {
    const root = join(dir, "root");
    mkdirSync(join(root, "DEBIAN"), { recursive: true });
    mkdirSync(join(root, "opt", "x"), { recursive: true });
    writeFileSync(join(root, "opt", "x", "hello.txt"), "hello\n");
    writeFileSync(join(root, "DEBIAN", "control"), "Package: x\nVersion: 1.0\nArchitecture: amd64\nMaintainer: X <x@localhost>\nDescription: x\n");
    const prev = process.env.MANTOU_NO_DPKG;
    process.env.MANTOU_NO_DPKG = "1";
    try {
      makeDeb(root, join(dir, "x.deb"));
    } finally {
      if (prev === undefined) delete process.env.MANTOU_NO_DPKG;
      else process.env.MANTOU_NO_DPKG = prev;
    }
    expect(sh(["dpkg-deb", "-f", join(dir, "x.deb"), "Package"]).trim()).toBe("x");
    expect(sh(["dpkg-deb", "-c", join(dir, "x.deb")])).toContain("./opt/x/hello.txt");
    sh(["dpkg-deb", "-x", join(dir, "x.deb"), join(dir, "out")]);
    expect(readFileSync(join(dir, "out", "opt", "x", "hello.txt"), "utf8")).toBe("hello\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!linux)("the counter as a .deb, a .tar.gz and an AppImage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-package-"));
  try {
    const icon = join(dir, "icon.svg");
    writeFileSync(icon, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#16a34a"/></svg>`);
    const made = await packageLinux("examples/counter/main.tsx", join(dir, "dist"), {
      name: "Mantou Counter",
      version: "1.2.0",
      description: "A counter",
      icon,
      categories: ["Utility", "Development"],
      keywords: ["count"],
      maintainer: "Someone <someone@example.com>",
    });
    const arch = process.arch === "arm64" ? ["arm64", "arm64", "aarch64"] : ["amd64", "x64", "x86_64"];
    expect(made.map((m) => m.slice(join(dir, "dist").length + 1))).toEqual([
      `mantou-counter_1.2.0_${arch[0]}.deb`,
      `mantou-counter-1.2.0-linux-${arch[1]}.tar.gz`,
      `mantou-counter-1.2.0-${arch[2]}.AppImage`,
    ]);
    const [deb, tar, appimage] = made;

    // The .deb: its fields, and where things go.
    if (Bun.which("dpkg-deb")) {
      const field = (f: string) => sh(["dpkg-deb", "-f", deb, f]).trim();
      expect(field("Package")).toBe("mantou-counter");
      expect(field("Version")).toBe("1.2.0");
      expect(field("Maintainer")).toBe("Someone <someone@example.com>");
      expect(field("Depends")).toBe("libc6 (>= 2.35), libxkbcommon-x11-0, libvulkan1 | libgl1");
      expect(field("Recommends")).toBe("mesa-vulkan-drivers, zenity | xdg-desktop-portal");
      const files = sh(["dpkg-deb", "-c", deb]);
      for (const f of ["./opt/mantou-counter/mantou-counter", "./opt/mantou-counter/libmantou_ffi.so", "./usr/bin/mantou-counter", "./usr/share/applications/mantou-counter.desktop", "./usr/share/icons/hicolor/48x48/apps/mantou-counter.png", "./usr/share/icons/hicolor/512x512/apps/mantou-counter.png", "./usr/share/icons/hicolor/scalable/apps/mantou-counter.svg"])
        expect(files).toContain(f);
    }

    // The tarball: install.sh into a prefix, then uninstall.sh.
    sh(["tar", "-xzf", tar, "-C", dir]);
    const top = join(dir, `mantou-counter-1.2.0-linux-${arch[1]}`);
    const prefix = join(dir, "prefix");
    sh([join(top, "install.sh")], { PREFIX: prefix });
    const desktop = readFileSync(join(prefix, "share", "applications", "mantou-counter.desktop"), "utf8");
    expect(desktop).toContain(`Exec=${prefix}/bin/mantou-counter %U`);
    expect(desktop).toContain("Name=Mantou Counter\n");
    expect(desktop).toContain("Categories=Utility;Development;\n");
    expect(desktop).toContain("StartupWMClass=mantou-counter\n"); // winit's WM_CLASS: the executable's name
    expect(readFileSync(join(prefix, "bin", "mantou-counter"), "utf8")).toContain(`exec "${prefix}/lib/mantou-counter/mantou-counter"`);
    expect(existsSync(join(prefix, "lib", "mantou-counter", "libmantou_ffi.so"))).toBe(true);
    // The icons are drawn at each size, with a transparent background.
    for (const size of [48, 64, 128, 256, 512]) {
      const png = decodePng(readFileSync(join(prefix, "share", "icons", "hicolor", `${size}x${size}`, "apps", "mantou-counter.png")));
      expect([png.width, png.height]).toEqual([size, size]);
      expect(png.pixels[3]).toBe(0); // the corner
      const mid = ((size / 2) * size + size / 2) * 4;
      expect([...png.pixels.subarray(mid, mid + 4)]).toEqual([0x16, 0xa3, 0x4a, 255]);
    }
    sh([join(top, "uninstall.sh")], { PREFIX: prefix });
    expect(existsSync(join(prefix, "bin", "mantou-counter"))).toBe(false);
    expect(existsSync(join(prefix, "lib", "mantou-counter"))).toBe(false);
    expect(existsSync(join(prefix, "share", "applications", "mantou-counter.desktop"))).toBe(false);

    // The AppImage: an executable that unpacks to the AppDir (no FUSE needed for that).
    expect([...readFileSync(appimage).subarray(0, 4)]).toEqual([0x7f, 0x45, 0x4c, 0x46]);
    Bun.spawnSync([appimage, "--appimage-extract"], { cwd: dir });
    const root = join(dir, "squashfs-root");
    expect(readdirSync(root).sort()).toEqual([".DirIcon", "AppRun", "mantou-counter.desktop", "mantou-counter.png", "usr"]);
    expect(readFileSync(join(root, "mantou-counter.desktop"), "utf8")).toContain("Exec=mantou-counter %U");
    expect(existsSync(join(root, "usr", "lib", "mantou-counter", "mantou-counter"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600_000);
