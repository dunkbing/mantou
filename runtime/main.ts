// Bootstrap. Runs on Bun's main thread: starts the app in a Worker, waits until
// the Worker has registered its wake-up callback, then hands this thread to the
// native event loop for the rest of the process (design §4, §7.1).
//
//   bun runtime/main.ts <app entry> [--width N] [--height N] [--title T]
//   (apps outside this repo use the `mantou` command: runtime/cli.ts)
import { resolve } from "node:path";
import { openCore } from "./ffi";
import { WindowFlag } from "./gen/protocol";

/** What the app asks of its window before it opens (run()'s options), in logical px. */
export interface WindowOptions {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  /** No title bar or border (draw your own, with a `dragRegion` view to move the window). */
  frameless?: boolean;
  /**
   * "overlay" (macOS): no visible title bar but the traffic-light buttons, with the content drawn up to the top edge;
   * leave `win.safeArea` free for the buttons. Elsewhere it is the native bar. Default "native".
   */
  titleBar?: "native" | "overlay";
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  maximized?: boolean;
  /** The window's outer position, logical px from the screen's top left. */
  x?: number;
  y?: number;
}

/**
 * Opens the window and runs `entry` (an app module, .ts or .tsx) in the app
 * Worker (`worker` is the app's own, for a compiled app that embeds its entry). Never returns: this thread runs the native event loop until the app
 * quits, then the process exits with its code.
 */
export async function start(entry: string, args: string[] = [], worker?: Worker, dev?: { watch: string }): Promise<never> {
  // Command-line flags win over what the app asks for, which wins over the defaults.
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  let asked: WindowOptions = {};

  process.env.MANTOU_T0 ??= String(Date.now());
  const core = openCore();

  // The Worker entry registers the JSX plugin, then imports the app. For
  // `mantou dev`, a supervisor runs the app in a Worker of its own, and starts
  // it again when a file changes (runtime/dev.ts).
  worker ??= new Worker(new URL(dev ? "./dev.ts" : "./worker.ts", import.meta.url).href);
  const w = worker;
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("mantou: the app Worker did not start within 10 s")), 10_000);
    w.addEventListener("message", (e) => {
      const data = (e as MessageEvent).data;
      if (data === "mantou:ready" || data?.type === "mantou:ready") {
        clearTimeout(timer);
        asked = data?.window ?? {};
        ok();
      } else if (data === "mantou:failed") {
        clearTimeout(timer);
        fail(new Error("mantou: the app failed to load (see the error above)"));
      }
    });
    w.addEventListener("error", (e) => {
      clearTimeout(timer);
      fail((e as ErrorEvent).error ?? new Error((e as ErrorEvent).message));
    });
    w.postMessage({ type: "mantou:entry", entry: Bun.pathToFileURL(resolve(entry)).href, watch: dev && resolve(dev.watch) });
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(70);
  });

  // From here on this thread runs no JavaScript: Worker messages and errors go
  // unread, so the Worker reports its own failures and quits (runtime/core.ts).
  const num = (name: string, fromApp: number | undefined, d: number) => {
    const v = Number(flag(name) ?? fromApp ?? d);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : d;
  };
  const title = new TextEncoder().encode(flag("title") ?? "Mantou");
  const cfg = new Uint8Array(40 + title.length);
  const placed = asked.x !== undefined && asked.y !== undefined;
  new Uint32Array(cfg.buffer, 0, 10).set([
    num("width", asked.width, 640),
    num("height", asked.height, 400),
    title.length,
    num("min-width", asked.minWidth, 0),
    num("min-height", asked.minHeight, 0),
    num("max-width", asked.maxWidth, 0),
    num("max-height", asked.maxHeight, 0),
    (asked.resizable === false ? WindowFlag.NotResizable : 0) |
      (asked.frameless ? WindowFlag.Frameless : 0) |
      (asked.alwaysOnTop ? WindowFlag.AlwaysOnTop : 0) |
      (asked.titleBar === "overlay" ? WindowFlag.TitleOverlay : 0) |
      (asked.fullscreen ? WindowFlag.Fullscreen : 0) |
      (asked.maximized ? WindowFlag.Maximized : 0) |
      (placed ? WindowFlag.HasPosition : 0),
    placed ? asked.x! | 0 : 0,
    placed ? asked.y! | 0 : 0,
  ]);
  cfg.set(title, 40);
  const code = core.symbols.mt_run(cfg, cfg.byteLength);
  process.exit(code);
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  await start(args.find((a) => !a.startsWith("--")) ?? "spike/app.ts", args);
}
