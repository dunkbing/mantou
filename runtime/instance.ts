// One running copy of an app: a second launch hands its arguments to the first and quits.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths";
import { win } from "./platform";

type Launch = (args: string[], cwd: string) => void;
const opens = new Set<(what: { url?: string; file?: string }) => void>();

/** Reports each argument that is a URL (`scheme://…`, `mailto:`) or an existing file. */
function dispatch(args: string[], cwd: string) {
  for (const a of args) {
    if (/^([a-z][a-z0-9+.-]*:\/\/|mailto:)/i.test(a)) opens.forEach((f) => f({ url: a }));
    else if (existsSync(join(cwd, a))) opens.forEach((f) => f({ file: join(cwd, a) }));
  }
}

/** Hears the URLs and files the app was launched with, and those later launches pass on. Returns a function that stops. */
export function onOpen(handler: (what: { url?: string; file?: string }) => void): () => void {
  opens.add(handler);
  dispatch(process.argv.slice(2), process.cwd());
  return () => void opens.delete(handler);
}

/**
 * Makes this the only running copy. Resolves true if it is (call it before `run`); false if another copy
 * was running and was handed this launch's arguments, in which case the caller should exit.
 * `onLaunch` hears the arguments of later launches (the window is focused for you).
 */
export async function singleInstance(onLaunch?: Launch): Promise<boolean> {
  const file = join(paths.temp, "instance.json");
  const args = process.argv.slice(2), cwd = process.cwd();
  try {
    const { port, token } = JSON.parse(readFileSync(file, "utf8"));
    const sent = await new Promise<boolean>((resolve) => {
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          open: (s) => void s.write(JSON.stringify({ token, args, cwd })),
          data: (s) => void (resolve(true), s.end()),
          close: () => resolve(false),
          error: () => resolve(false),
          connectError: () => resolve(false),
        },
      }).catch(() => resolve(false));
    });
    if (sent) return false;
  } catch {} // no file, or a stale one: this copy takes over
  const token = randomBytes(16).toString("hex");
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(s, chunk) {
        try {
          const m = JSON.parse(chunk.toString());
          if (m.token !== token) return s.end();
          s.end("ok");
          try {
            void win.focus().catch(() => {});
          } catch {} // no window yet
          onLaunch?.(m.args, m.cwd);
          dispatch(m.args, m.cwd);
        } catch {
          s.end();
        }
      },
    },
  });
  writeFileSync(file, JSON.stringify({ port: server.port, token }), { mode: 0o600 });
  return true;
}
