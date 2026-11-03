// Bootstrap. Runs on Bun's main thread: starts the app in a Worker, waits until
// the Worker has registered its wake-up callback, then hands this thread to the
// native event loop for the rest of the process (design §4, §7.1).
//
//   bun runtime/main.ts <app entry> [--width N] [--height N] [--title T]
import { resolve } from "node:path";
import { openCore } from "./ffi";

const args = Bun.argv.slice(2);
const entry = args.find((a) => !a.startsWith("--")) ?? "spike/app.ts";
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

process.env.MANTOU_T0 ??= String(Date.now());
const core = openCore();

// The Worker entry registers the JSX plugin, then imports the app.
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
await new Promise<void>((ok, fail) => {
  const timer = setTimeout(() => fail(new Error("mantou: the app Worker did not start within 10 s")), 10_000);
  worker.addEventListener("message", (e) => {
    const data = (e as MessageEvent).data;
    if (data === "mantou:ready") {
      clearTimeout(timer);
      ok();
    } else if (data === "mantou:failed") {
      clearTimeout(timer);
      fail(new Error("mantou: the app failed to load (see the error above)"));
    }
  });
  worker.addEventListener("error", (e) => {
    clearTimeout(timer);
    fail((e as ErrorEvent).error ?? new Error((e as ErrorEvent).message));
  });
  worker.postMessage({ type: "mantou:entry", entry: Bun.pathToFileURL(resolve(entry)).href });
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(70);
});

// From here on this thread runs no JavaScript: Worker messages and errors go
// unread, so the Worker reports its own failures and quits (runtime/core.ts).
const title = new TextEncoder().encode(opt("title", "Mantou"));
const cfg = new Uint8Array(12 + title.length);
new Uint32Array(cfg.buffer, 0, 3).set([Number(opt("width", "640")), Number(opt("height", "400")), title.length]);
cfg.set(title, 12);
const code = core.symbols.mt_run(cfg, cfg.byteLength);
process.exit(code);
