// bun run todos  (bun runtime/cli.ts run examples/todos/main.tsx --width 420 --height 520)
import { run } from "mantou-ui";
import { Todos } from "./Todos";

run(() => <Todos />, { title: "Mantou to-dos" });
