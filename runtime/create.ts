// `mantou create <dir>`: a starter app (a counter with a test), so a new project begins from something that runs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function version(): string {
  const v = (JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { version?: string }).version;
  return v && v !== "0.0.0" ? v : "latest";
}

const APP = `import { Text, View, createSignal } from "mantou-ui";

export function App() {
  const [count, setCount] = createSignal(0);
  return (
    <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#f8fafc" }}>
      <Text style={{ fontSize: 40, fontWeight: 700, color: "#0f172a" }}>{count()}</Text>
      <View
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
import { App } from "./App";

run(() => <App />, { title: "__NAME__", width: 480, height: 360 });
`;

const TEST = `import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "./App";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("pressing +1 counts", () => {
  const h = new HeadlessCore();
  open.push(h);
  mount(h.ui, () => <App />);
  h.step();
  const plus = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === "+1")!;
  h.press(plus).press(plus);
  expect([...h.ui.nodes.values()].some((n) => n.isText && n.textContent === "2")).toBe(true);
});
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
        scripts: { dev: "mantou dev src/main.tsx", start: "mantou run src/main.tsx", build: `mantou build src/main.tsx --name ${name}`, test: "bun test", typecheck: "bun check" },
        dependencies: { "mantou-ui": version() },
        devDependencies: { "@types/bun": "latest" },
      },
      null,
      2,
    ) + "\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "bundler", lib: ["ESNext"], types: ["bun"], strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve", jsxImportSource: "mantou-ui" }, include: ["src"] }, null, 2) + "\n",
    "bunfig.toml": '[test]\n# Compile .tsx with Mantou\'s JSX plugin.\npreload = ["mantou-ui/preload"]\n',
    ".gitignore": "node_modules\ndist\n",
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
