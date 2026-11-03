// bun run counter  (bun runtime/main.ts examples/counter/main.tsx)
import { run } from "mantou-ui";
import { Counter } from "./Counter";

run(() => <Counter />, { title: "Mantou counter" });
