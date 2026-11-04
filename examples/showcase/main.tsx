// bun run showcase  (bun runtime/cli.ts run examples/showcase/main.tsx --width 800 --height 500)
import { join } from "node:path";
import { run } from "mantou-ui";
import { Showcase } from "./Showcase";

run(() => <Showcase mono="Mantou Test Mono" />, { title: "Mantou", fonts: [join(import.meta.dir, "../../tests/fonts/MantouTestMono.ttf")] });
