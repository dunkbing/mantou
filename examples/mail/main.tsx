// bun run mail  (bun runtime/main.ts examples/mail/main.tsx --width 1200 --height 760)
import { run } from "mantou-ui";
import { App } from "./App";

run(() => <App />, { title: "Mantou Mail" });
