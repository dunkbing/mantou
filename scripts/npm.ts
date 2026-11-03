// Stages the npm packages of a release (run by .github/workflows/release.yml):
//
//   bun scripts/npm.ts <version> <cores-dir> <out-dir>
//
// <cores-dir> holds one folder per platform, named as below, with the core
// built for it. Writes <out-dir>/<package>/ for every platform package and
// for mantou-ui itself: its files are exactly what `npm pack` would include,
// and its package.json gets the version, the platform packages as optional
// dependencies, and no "private". Platform packages come first in
// <out-dir>/order.txt: they must be on the registry before mantou-ui.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PLATFORMS = [
  { os: "linux", cpu: "x64", file: "libmantou_ffi.so" },
  { os: "linux", cpu: "arm64", file: "libmantou_ffi.so" },
  { os: "darwin", cpu: "arm64", file: "libmantou_ffi.dylib" },
  { os: "darwin", cpu: "x64", file: "libmantou_ffi.dylib" },
  { os: "win32", cpu: "x64", file: "mantou_ffi.dll" },
] as const;

const root = join(import.meta.dir, "..");
const [version, coresDir, outDir] = Bun.argv.slice(2);
if (!version || !coresDir || !outDir) {
  console.error("usage: bun scripts/npm.ts <version> <cores-dir> <out-dir>");
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`not a version: ${version}`);

const pkg = await Bun.file(join(root, "package.json")).json();
const common = { version, license: pkg.license, repository: pkg.repository, homepage: pkg.homepage };
rmSync(outDir, { recursive: true, force: true });
const order: string[] = [];

for (const p of PLATFORMS) {
  const name = `mantou-ui-${p.os}-${p.cpu}`;
  const lib = join(coresDir, `${p.os}-${p.cpu}`, p.file);
  if (!existsSync(lib)) throw new Error(`missing core for ${p.os}-${p.cpu}: ${lib}`);
  const dir = join(outDir, name);
  mkdirSync(dir, { recursive: true });
  cpSync(lib, join(dir, p.file));
  // The core embeds the Inter font: its licence goes with it.
  cpSync(join(root, "core/crates/mantou-text/fonts/OFL.txt"), join(dir, "OFL.txt"));
  const manifest = {
    name,
    ...common,
    description: `Mantou's native core for ${p.os} ${p.cpu}. Installed by mantou-ui; not used directly.`,
    os: [p.os],
    cpu: [p.cpu],
    ...(p.os === "linux" ? { libc: ["glibc"] } : {}),
    files: [p.file, "OFL.txt"],
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(dir, "README.md"), `# ${name}\n\n${manifest.description}\nSee [mantou-ui](https://www.npmjs.com/package/mantou-ui).\n`);
  order.push(name);
}

// mantou-ui: the files `npm pack` would take, and a release package.json.
const pack = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
if (pack.exitCode !== 0) throw new Error(`npm pack failed: ${pack.stderr.toString()}`);
const files: string[] = JSON.parse(pack.stdout.toString())[0].files.map((f: { path: string }) => f.path);
const main = join(outDir, "mantou-ui");
for (const f of files) {
  if (f === "package.json") continue;
  mkdirSync(dirname(join(main, f)), { recursive: true });
  cpSync(join(root, f), join(main, f));
}
delete pkg.private;
delete pkg.scripts;
delete pkg.devDependencies;
pkg.version = version;
pkg.optionalDependencies = Object.fromEntries(order.map((n) => [n, version]));
writeFileSync(join(main, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
order.push("mantou-ui");

writeFileSync(join(outDir, "order.txt"), order.join("\n") + "\n");
console.log(`staged ${order.length} packages at ${version} in ${outDir}: ${order.join(", ")}`);
