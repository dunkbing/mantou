// Installs mantou-ui into a fresh app and runs a headless test there, as an
// app would (run by .github/workflows/release.yml on each platform):
//
//   bun scripts/smoke.ts tarballs <dir> <version>   from `npm pack` tarballs, before publishing
//   bun scripts/smoke.ts registry <version>          from npm, after publishing
//
// The test types into an <Input> on a headless instance: it needs the
// prebuilt core for this machine, JSX through the preload, and Solid.
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PLATFORM_PACKAGE as platformPackage } from "../runtime/ffi";

const [mode, a, b] = Bun.argv.slice(2);
const app = mkdtempSync(join(tmpdir(), "mantou-smoke-"));

let deps: Record<string, unknown>;
if (mode === "tarballs" && a && b) {
  const tgz = (name: string) => "file:" + resolve(a, `${name}-${b}.tgz`).replaceAll("\\", "/");
  // The platform packages aren't on the registry yet: point mantou-ui's optional dependency at the tarball.
  deps = { dependencies: { "mantou-ui": tgz("mantou-ui") }, overrides: { [platformPackage]: tgz(platformPackage) } };
} else if (mode === "registry" && a) {
  deps = { dependencies: { "mantou-ui": a } };
} else {
  console.error("usage: bun scripts/smoke.ts tarballs <dir> <version> | registry <version>");
  process.exit(2);
}

writeFileSync(join(app, "package.json"), JSON.stringify({ name: "mantou-smoke", private: true, type: "module", ...deps }, null, 2));
writeFileSync(join(app, "bunfig.toml"), '[test]\npreload = ["mantou-ui/preload"]\n');
writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve", jsxImportSource: "mantou-ui" } }));
mkdirSync(join(app, "tests"));
writeFileSync(
  join(app, "tests", "smoke.test.tsx"),
  `import { expect, test } from "bun:test";
import { Input, Text, View, mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";

test("mantou-ui runs on its prebuilt core", () => {
  const h = new HeadlessCore();
  let input!: Node;
  mount(h.ui, () => (
    <View style={{ padding: 16, gap: 8 }}>
      <Text>Hello</Text>
      <Input ref={input} autoFocus />
    </View>
  ));
  h.step().type("typed");
  expect(h.value(input)).toBe("typed");
  expect(h.stats().glyphs).toBe(10);
  h.free();
});
`,
);

const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: app, stdio: ["inherit", "inherit", "inherit"] }).exitCode;

// npm checks new uploads before serving them: a version can take several
// minutes to appear (9 for one package of 0.1.1). Keep trying for 30.
let installed = false;
for (let attempt = 1; attempt <= (mode === "registry" ? 60 : 1); attempt++) {
  if (run(["bun", "install"]) === 0) {
    installed = true;
    break;
  }
  console.log(`install failed (attempt ${attempt}); retrying in 30 s`);
  await Bun.sleep(30_000);
}
if (!installed) process.exit(1);
console.log(`smoke app at ${app}, with ${platformPackage}`);
process.exit(run(["bun", "test"]));
