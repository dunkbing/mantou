// `mantou create <dir>`: a starter app (a counter with a test), so a new project begins from something that runs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function version(): string {
  const v = (JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { version?: string }).version;
  return v && v !== "0.0.0" ? v : "latest";
}

const APP = `import { Text, View, createSignal } from "mantou-ui";

// State lives in the module, so tests and \`mantou snap\`'s scenes (main.tsx) can set it.
export const [count, setCount] = createSignal(0);

export function App() {
  return (
    <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#f8fafc" }}>
      <Text testId="count" style={{ fontSize: 40, fontWeight: 700, color: "#0f172a" }}>{count()}</Text>
      <View
        testId="plus"
        role="button"
        label="Add one"
        style={{ width: 120, height: 40, justifyContent: "center", alignItems: "center", borderRadius: 8, backgroundColor: "#2563eb", cursor: "pointer" }}
        onPress={() => setCount((n) => n + 1)}
      >
        <Text style={{ color: "#ffffff", fontWeight: 600 }}>+1</Text>
      </View>
    </View>
  );
}
`;

const MAIN = `import { run } from "mantou-ui";
import { App, setCount } from "./App";

// Named states for \`mantou snap --scene NAME\` (and agents checking their work): \`bun run snap -- --scene many\`.
export const scenes = {
  many: () => setCount(42),
};

run(() => <App />, { title: "__NAME__", width: 480, height: 360 });
`;

const TEST = `import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App, setCount } from "./App";

const open: HeadlessCore[] = [];
afterEach(() => {
  open.splice(0).forEach((h) => h.free());
  setCount(0);
});

test("pressing +1 counts", () => {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => <App />);
  h.step();
  h.press("plus").press("plus");
  expect(h.find("count")!.textContent).toBe("2");
  // The screen as text: each node's testId, text and box as drawn.
  expect(h.treeText()).toContain('[count] "2"');
});
`;

const AGENTS = `# AGENTS.md

A desktop app built with [Mantou](https://github.com/dunkbing/mantou): Bun + TypeScript + Solid JSX, drawn natively
(no web view). Docs: https://mantou.dunkbing.dev (for LLMs: \`/llms.txt\`, \`/llms-full.txt\`, any page as \`.md\`).

## Commands

\`\`\`bash
bun run dev            # the app in a window; reloads on save
bun test               # headless tests (real renderer, no window)
bun run typecheck
bun run snap           # the app headless: prints what's on screen, writes .mantou/snap.png
\`\`\`

## Check your work without a screen

- \`bun run snap\` prints the screen as a tree: each node's kind, \`[testId]\`, text, box as drawn, role, and whether
  it's hidden, clipped, faded or animating. Look at \`.mantou/snap.png\` for the pixels.
- Drive it: \`bun run snap -- --script '[{"press":"plus"},{"type":"hello","into":"name"},{"wait":300}]'\`.
  Targets are \`testId\`s; a missing one fails and lists the testIds there are.
- Start from a state: \`--scene NAME\` (\`scenes\` in src/main.tsx). \`--list-scenes\` lists them.
- Motion: \`--strip sheet.png\` (an animation as a contact sheet), \`--check-motion\` (fails on jumps, flicker and
  animations that never end).
- \`bun run dev -- --snap\` rewrites .mantou/dev-snap.png and its tree (.txt) after every reload.

## Rules

- Give anything a test or a script needs to find a \`testId\`; tests use \`h.press("plus")\`, \`h.find("count")\`,
  \`h.tree()\` and \`h.treeText()\` (\`mantou-ui/headless\`), not text searches.
- Import everything (Solid's API too) from \`mantou-ui\`, never from \`solid-js\`.
- Text goes in \`<Text>\`. Layout is flexbox; fixed-size parts need \`flexShrink: 0\`.
- Keep app state in modules (signals) so scenes and tests can set it.
`;

/** Writes the starter app into `dir` (created if needed, and empty); returns the files written. */
export function create(dir: string): string[] {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`mantou: ${dir} isn't empty`);
  const name = basename(root);
  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { dev: "mantou dev src/main.tsx", start: "mantou run src/main.tsx", snap: "mantou snap src/main.tsx --out .mantou/snap.png", build: `mantou build src/main.tsx --name ${name}`, test: "bun test", typecheck: "bun check" },
        dependencies: { "mantou-ui": version() },
        devDependencies: { "@types/bun": "latest" },
      },
      null,
      2,
    ) + "\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "bundler", lib: ["ESNext"], types: ["bun"], strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve", jsxImportSource: "mantou-ui" }, include: ["src"] }, null, 2) + "\n",
    "bunfig.toml": '[test]\n# Compile .tsx with Mantou\'s JSX plugin.\npreload = ["mantou-ui/preload"]\n',
    ".gitignore": "node_modules\ndist\n.mantou\n",
    "AGENTS.md": AGENTS,
    "CLAUDE.md": "@AGENTS.md\n",
    "src/App.tsx": APP,
    "src/main.tsx": MAIN.replace("__NAME__", name),
    "src/App.test.tsx": TEST,
  };
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return Object.keys(files);
}
