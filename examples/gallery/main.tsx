// bun run gallery  (bun runtime/cli.ts run examples/gallery/main.tsx)
import { run } from "mantou-ui";
import { Gallery, setTab } from "./Gallery";

// `mantou snap examples/gallery/main.tsx --scene more` shows a tab without pressing it.
export const scenes = {
  controls: () => setTab("controls"),
  layout: () => setTab("layout"),
  more: () => setTab("more"),
};

run(() => <Gallery />, { title: "Components", width: 560, height: 420 });
