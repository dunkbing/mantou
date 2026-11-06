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
//
// Babel is slow to load and to run (about 200 ms and 40 MB to load, and 250 ms for the widgets), so
// compiled files are kept in the user's cache folder (`MANTOU_JSX_CACHE`: another folder, or 0 for
// none), and Babel loads only when a file isn't there or changed.

import type { BunPlugin } from "bun";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { base } from "../paths";

const runtime = join(import.meta.dir, "..");
const solidClient = Bun.resolveSync("solid-js/dist/solid.js", runtime);
const toClient = (code: string) => code.replace(/(from\s*|import\s*\(\s*)(['"])solid-js\2/g, `$1${JSON.stringify(solidClient)}`);

let compiler: Promise<(source: string, path: string) => Promise<string>> | undefined;
function babel() {
  return (compiler ??= (async () => {
    const [{ transformAsync }, { default: solid }, { default: typescript }] = await Promise.all([import("@babel/core"), import("babel-preset-solid"), import("@babel/preset-typescript")]);
    return async (source: string, path: string) => {
      const out = await transformAsync(source, {
        filename: path,
        babelrc: false,
        configFile: false,
        sourceMaps: "inline",
        // Bun doesn't apply an inline source map returned from onLoad, so keep
        // the compiled code on its source lines: stack traces and test
        // failures then name the right line (columns are the compiled ones).
        // dunkbing/mantou#2.
        retainLines: true,
        presets: [
          [solid, { generate: "universal", moduleName: "mantou-ui/solid" }],
          [typescript, { isTSX: true, allExtensions: true }],
        ],
      });
      if (!out?.code) throw new Error(`mantou: could not compile ${path}`);
      return toClient(out.code);
    };
  })());
}

// The cache: one file per source file, named by its path and what compiles it, holding the source's hash and the code.
let cache: { dir: string; id: string } | null | undefined;
function cacheDir() {
  if (cache !== undefined) return cache;
  const env = process.env.MANTOU_JSX_CACHE;
  if (env === "0") return (cache = null);
  try {
    const version = (pkg: string) => {
      try {
        return JSON.parse(readFileSync(Bun.resolveSync(`${pkg}/package.json`, runtime), "utf8")).version;
      } catch {
        return "?";
      }
    };
    const id = [readFileSync(import.meta.path, "utf8"), solidClient, ...["@babel/core", "babel-preset-solid", "@babel/preset-typescript", "solid-js"].map(version)].join("\0");
    const dir = env || join(base("cache"), "mantou", "jsx");
    mkdirSync(dir, { recursive: true });
    cache = { dir, id: Bun.hash(id).toString(36) };
  } catch {
    cache = null;
  }
  return cache;
}

async function compile(path: string): Promise<string> {
  const source = await Bun.file(path).text();
  const c = cacheDir();
  if (!c) return (await babel())(source, path);
  const file = join(c.dir, `${Bun.hash(c.id + path).toString(36)}.js`);
  const stamp = `// ${Bun.hash(source).toString(36)}\n`;
  try {
    const kept = await Bun.file(file).text();
    if (kept.startsWith(stamp)) return kept.slice(stamp.length);
  } catch {}
  const code = await (await babel())(source, path);
  try {
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    await Bun.write(tmp, stamp + code);
    renameSync(tmp, file); // whole or not at all, with other processes compiling the same file
  } catch {}
  return code;
}

export const mantouJsx: BunPlugin = {
  name: "mantou-jsx",
  setup(build) {
    build.onLoad({ filter: /solid-js[^/\\]*[/\\](universal|store)[/\\]dist[/\\][^/\\]+\.js$/ }, async ({ path }) => ({
      contents: toClient(await Bun.file(path).text()),
      loader: "js",
    }));
    build.onLoad({ filter: /\.[jt]sx$/ }, async ({ path }) => ({ contents: await compile(path), loader: "js" }));
  },
};
