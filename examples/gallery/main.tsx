// bun run gallery  (bun runtime/cli.ts run examples/gallery/main.tsx)
import { run } from "mantou-ui";
import { Gallery } from "./Gallery";

run(() => <Gallery />, { title: "Components", width: 560, height: 420 });
