// `mantou dev`'s supervisor (dunkbing/mantou#25). It runs in the Worker the
// bootstrap starts, in place of the app's (the main thread runs no JS once the
// native loop starts, design §4), and runs the app in a Worker of its own.
// When a file under the watched folder changes, it resets the window's UI
// (mt_reset: the window and its instance stay) and starts the app again in a
// new Worker. A load error or an uncaught error is printed and shown in the
// window until the next save.
import { watch } from "node:fs";
import { relative } from "node:path";
import { STAT_NAMES, statsFrom, type Stats } from "./events";
import { openCore } from "./ffi";
import { Ui } from "./ui";

const lib = openCore();
const handle = lib.symbols.mt_app();
let entry = "";
let app: Worker | null = null;
/** The next app's Worker, started ahead with the JSX plugin (and Babel) loaded, so a reload only compiles the app. */
let spare: Worker | null = null;
const newWorker = () => new Worker(new URL("./worker.ts", import.meta.url).href);
/** A Worker for the next reload, with the framework loaded. */
function warm(): Worker {
  const w = newWorker();
  // MANTOU_DEV_TRACE: say when it's ready (spike/devtest.ts waits for that, not for a time).
  if (process.env.MANTOU_DEV_TRACE) w.addEventListener("message", (e) => (e as MessageEvent).data?.type === "mantou:warmed" && console.log("mantou: warmed the next reload"));
  w.postMessage({ type: "mantou:warm" });
  return w;
}
let generation = 0;
let opened = false;
/** When the change that caused this reload was seen (performance.now()). */
let changedAt = 0;

function stats(): Stats {
  const a = new BigUint64Array(STAT_NAMES.length);
  lib.symbols.mt_stats(handle, a, a.length);
  return statsFrom(a);
}

addEventListener(
  "message",
  (e: Event) => {
    const data = (e as MessageEvent).data;
    if (data?.type !== "mantou:entry") return;
    entry = data.entry;
    start();
    watchFiles(data.watch as string);
  },
  { once: true },
);

/** Starts the app in a new Worker; the previous one (if any) is gone already. */
function start() {
  const gen = ++generation;
  const before = stats();
  const w = spare ?? newWorker();
  app = w;
  w.addEventListener("message", (e) => {
    if (gen !== generation) return;
    const data = (e as MessageEvent).data;
    if (data?.type === "mantou:ready") {
      if (!opened) {
        opened = true;
        postMessage(data); // the bootstrap opens the window with the app's options
        void reported(gen, before, "started", Number(process.env.MANTOU_T0 ?? Date.now()) - Date.now() + performance.now());
      } else void reported(gen, before, "reloaded", changedAt);
    } else if (data?.type === "mantou:error") showError(data.message);
  });
  w.addEventListener("error", (e) => gen === generation && showError(String((e as ErrorEvent).error ?? (e as ErrorEvent).message)));
  w.postMessage({ type: "mantou:entry", entry, dev: true });
  // Warm the next one once this app has had a moment to start.
  spare = null;
  setTimeout(() => gen === generation && !spare && (spare = warm()), 200);
}

/** Ends the app's Worker and empties the window, keeping it. */
function stop() {
  generation++;
  // No wake-up reaches the old Worker once this returns (mt_reset clears its callback first).
  lib.symbols.mt_reset(handle);
  app?.terminate();
  app = null;
}

/** Once the app has drawn a frame: how long since `since` (performance.now()): the launch, or the save. */
async function reported(gen: number, before: Stats, what: string, since: number) {
  for (const giveUp = performance.now() + 30_000; performance.now() < giveUp; ) {
    if (gen !== generation) return;
    const now = stats();
    if (now.commits > before.commits && now.frames > before.frames) {
      console.log(`mantou: ${what} in ${Math.round(performance.now() - since)} ms (to its first frame; ${now.glyphs} glyphs)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2));
  }
}

function reload(why: string) {
  console.log(`mantou: ${why} changed, reloading`);
  stop();
  start();
}

/** Prints the error and shows it in the window, until the next save. */
function showError(message: string) {
  console.error(`mantou: ${message}`);
  stop();
  if (!opened) {
    opened = true;
    postMessage({ type: "mantou:ready", window: {} });
  }
  const ui = new Ui({ commit: (bytes) => void lib.symbols.mt_commit(handle, bytes, bytes.byteLength) });
  const root = ui.view({ flexGrow: 1, padding: 24, gap: 12, backgroundColor: "#1c1917" });
  const title = ui.textNode({ color: "#fca5a5", fontSize: 16, fontWeight: 700 });
  title.append(ui.text("The app failed"));
  const body = ui.textNode({ color: "#e7e5e4", fontSize: 13, whiteSpace: "pre", lineHeight: 1.4 });
  body.append(ui.text(message.slice(0, 4000)));
  const hint = ui.textNode({ color: "#a8a29e", fontSize: 12 });
  hint.append(ui.text("Save a file to try again."));
  root.append(title);
  root.append(body);
  root.append(hint);
  ui.setRoot(root);
  ui.flush();
  spare ??= warm(); // so the fix reloads quickly too
}

/** Reloads when a source file under `dir` changes (a burst of changes is one reload). */
function watchFiles(dir: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  console.log(`mantou: watching ${relative(process.cwd(), dir) || "."} for changes`);
  watch(dir, { recursive: true }, (_event, file) => {
    const name = String(file ?? "");
    if (/(^|[/\\])(node_modules|\.git|dist|build|target)([/\\]|$)/.test(name) || /(^|[/\\])\./.test(name) || /~$|\.swp$/.test(name)) return;
    if (timer === undefined) changedAt = performance.now();
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      reload(relative(process.cwd(), `${dir}/${name}`) || name);
    }, 30);
  });
}
