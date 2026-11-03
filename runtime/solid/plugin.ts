// The Bun plugin that compiles Mantou's JSX (design §7.2). Bun's own JSX
// transform is React-style, so .jsx/.tsx files go through Babel with
// babel-preset-solid in "universal" mode, which turns JSX into fine-grained
// calls to Mantou's Solid renderer (runtime/solid/renderer.ts).
//
// It also pins `solid-js` to its client build: Bun resolves `solid-js` through
// the package's "node" export condition to dist/server.js, the server build,
// whose effects never re-run, and runtime plugins can't redirect bare imports
// (onResolve never sees them). So onLoad rewrites `solid-js` imports in
// Solid's own subpackages (universal, store) and in app .tsx files.
import type { BunPlugin } from "bun";
import { transformAsync } from "@babel/core";
import solid from "babel-preset-solid";
import typescript from "@babel/preset-typescript";
import { join } from "node:path";

const runtime = join(import.meta.dir, "..");
const solidClient = Bun.resolveSync("solid-js/dist/solid.js", runtime);
const toClient = (code: string) => code.replace(/(from\s*|import\s*\(\s*)(['"])solid-js\2/g, `$1${JSON.stringify(solidClient)}`);

export const mantouJsx: BunPlugin = {
  name: "mantou-jsx",
  setup(build) {
    build.onLoad({ filter: /solid-js[^/\\]*[/\\](universal|store)[/\\]dist[/\\][^/\\]+\.js$/ }, async ({ path }) => ({
      contents: toClient(await Bun.file(path).text()),
      loader: "js",
    }));
    build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const out = await transformAsync(source, {
        filename: path,
        babelrc: false,
        configFile: false,
        sourceMaps: "inline",
        presets: [
          [solid, { generate: "universal", moduleName: "mantou-ui/solid" }],
          [typescript, { isTSX: true, allExtensions: true }],
        ],
      });
      if (!out?.code) throw new Error(`mantou: could not compile ${path}`);
      return { contents: toClient(out.code), loader: "js" };
    });
  },
};
