// Worker entry: bun runtime/main.ts examples/counter/main.ts
import { MantouCore } from "../../runtime/core";
import { counter } from "./counter";

const core = new MantouCore();
counter(core.ui);
core.onEvent = (e) => {
  if (e.type === "closeRequested" || (e.type === "keyDown" && e.key === "Escape")) core.quit(0);
};
core.ready();
