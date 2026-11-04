// Renders the README's screenshots at 2× on a headless instance:
//
//   bun run screenshots      (writes docs/images/showcase.png and todos.png)
//
// Run through the JSX preload: `bun --preload ./runtime/solid/preload.ts scripts/screenshots.tsx`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mount } from "mantou-ui";
import { encodePng } from "mantou-ui/images";
import { HeadlessCore } from "../runtime/headless";
import type { JSX } from "../runtime/jsx-runtime";
import { Showcase } from "../examples/showcase/Showcase";
import { Todos } from "../examples/todos/Todos";

const root = join(import.meta.dir, "..");
const mono = new Uint8Array(readFileSync(join(root, "tests/fonts/MantouTestMono.ttf")));

function shoot(name: string, width: number, height: number, ui: () => JSX.Element, then?: (h: HeadlessCore) => void) {
  const h = new HeadlessCore({ width, height, scale: 2 });
  h.ui.registerFont(mono);
  mount(h.ui, ui);
  h.step();
  then?.(h);
  const path = join(root, "docs/images", `${name}.png`);
  writeFileSync(path, encodePng(h.step().capture()));
  h.free();
  console.log(`wrote ${path}`);
}

shoot("showcase", 800, 500, () => <Showcase mono="Mantou Test Mono" />);
shoot(
  "todos",
  420,
  520,
  () => (
    <Todos
      initial={[
        { text: "Ship 0.1.4 to npm", done: true },
        { text: "Box shadows", done: true },
        { text: "App fonts", done: true },
        { text: "Images and SVG icons", done: false },
        { text: "Virtualized lists", done: false },
      ]}
    />
  ),
  (h) => h.type("Accessibility"),
);
