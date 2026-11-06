// Motion settings for every window: reduced motion (the system's, or the app's choice), changes that skip
// their transitions (`instant`), and a slower animation clock for looking at motion.
import { MotionFlag } from "./gen/protocol";
import { batch, createSignal } from "./solid/solid";
import { Ui } from "./ui";

const [system, setSystem] = createSignal(false);
const [forced, setForced] = createSignal<boolean | null>(null);
let asked = false;

function send() {
  const flags = (forced() ?? system()) ? MotionFlag.Reduced : 0;
  Ui.motion = { flags, speed: Ui.motion.speed };
  for (const ui of Ui.live) {
    ui.enc.motion(flags, Ui.motion.speed);
    ui.schedule();
  }
}

/** Runs a command and returns what it printed, or null when it can't run. */
async function read(cmd: string[]): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

/** Whether the OS asks for reduced motion (`MANTOU_REDUCED_MOTION=1` or `0` overrides it). */
export async function systemReducedMotion(): Promise<boolean> {
  const env = process.env.MANTOU_REDUCED_MOTION;
  if (env === "1" || env === "0") return env === "1";
  if (process.platform === "darwin") return (await read(["defaults", "read", "com.apple.universalaccess", "reduceMotion"])) === "1";
  if (process.platform === "win32") {
    // "Show animations in Windows" off: MinAnimate is 0.
    const out = await read(["reg", "query", "HKCU\\Control Panel\\Desktop\\WindowMetrics", "/v", "MinAnimate"]);
    return !!out && /MinAnimate\s+REG_SZ\s+0\b/.test(out);
  }
  return (await read(["gsettings", "get", "org.gnome.desktop.interface", "enable-animations"])) === "false";
}

/** @internal Asks the OS once (for an app with a window); the answer applies to every window. */
export function followSystemMotion() {
  if (asked) return;
  asked = true;
  void systemReducedMotion().then((on) => {
    setSystem(on);
    send();
  });
}

/**
 * Whether motion is reduced, as a signal: the system's setting unless `setReducedMotion` chose. With it on,
 * movement (translate, scale, rotate and layout transitions and animations) jumps to its end and only fades
 * play; apps can also read it to pick simpler effects.
 */
export function useReducedMotion(): () => boolean {
  return () => forced() ?? system();
}

/** Turns reduced motion on or off for the app, or back to the system's setting with "system". */
export function setReducedMotion(on: boolean | "system") {
  setForced(on === "system" ? null : on);
  send();
}

/**
 * Plays animations at `speed` times real time (1 = normal): 0.25 shows them four times slower, to look at
 * motion closely, in a window or a headless test.
 */
export function setAnimationSpeed(speed: number) {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new Error("mantou: setAnimationSpeed takes a positive number");
  Ui.motion = { flags: Ui.motion.flags, speed };
  for (const ui of Ui.live) {
    ui.enc.motion(Ui.motion.flags, speed);
    ui.schedule();
  }
}

/**
 * Applies the changes `fn` makes (styles set by it and by the effects it sets off) at once, with no
 * transitions: running ones of those properties end there, and nothing slides to its new place in the
 * next layout. For a state that should appear rather than animate (restoring a view, a window opening).
 */
export function instant<T>(fn: () => T): T {
  const uis = [...Ui.live];
  for (const ui of uis) ui.enc.instant(true);
  try {
    return batch(fn);
  } finally {
    for (const ui of uis) {
      ui.enc.instant(false);
      ui.schedule();
    }
  }
}
