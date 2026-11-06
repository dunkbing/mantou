// `mantou snap`: runs an app headless, the way a window would show it, and reports what's on screen. An agent
// (or a person, or CI) can look at any state of any app without a display: a PNG, the tree as text or JSON,
// an animation as a contact sheet, and a motion check, after named scenes and scripted input.
//
//   mantou snap src/main.tsx --out shot.png
//   mantou snap src/main.tsx --scene empty --script steps.json --tree tree.json
//
// The entry is the app's own (it calls `run()`, which mounts into a headless instance here instead of opening
// a window) or a module whose default export is a component. Scenes are the entry's `export const scenes`:
// named functions that put the app's state somewhere (`{ empty: () => setMessages([]) }`), applied with no
// transitions.
import { mkdirSync, writeFileSync as write } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JSX } from "./jsx-runtime";
import { HeadlessCore, type KeyMods, type Target } from "./headless";
import { instant, setReducedMotion } from "./motion";
import { encodePng } from "./png";
import { SNAP, type RunOptions } from "./run";
import { setColorScheme } from "./theme";
import { mount } from "./solid/mount";
import { treeText } from "./inspect";
import { SNAP_USAGE } from "./snap-usage";



/** Writes a file, making its folder first. */
function writeFileSync(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  write(path, data);
}

type Step =
  | { press: Target; mods?: KeyMods }
  | { hover: Target }
  | { type: string; into?: Target }
  | { key: string; mods?: KeyMods }
  | { scroll: Target; dy?: number; dx?: number }
  | { wait: number }
  | { resize: [number, number] }
  | { snap: string }
  | { tree: string }
  | { scene: string };

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Lets promises and timers the app started run, stepping the core between (image loads, data). */
async function settle(h: HeadlessCore) {
  for (let i = 0; i < 5; i++) {
    await Bun.sleep(0);
    h.step();
  }
}

/** Advances the clock until nothing animates, up to `max` ms. */
function settleAnimations(h: HeadlessCore, max = 2000) {
  for (let t = 0; t < max; t += 50) {
    if (![...h.presented().values()].some((b) => b.animating)) return;
    h.step(50);
  }
}

function writeTree(h: HeadlessCore, path: string) {
  writeFileSync(path, path.endsWith(".json") ? JSON.stringify(h.tree(), null, 2) : `${h.treeText()}\n`);
}

export async function snapRun(args: string[]): Promise<number> {
  const entry = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--list-scenes", "--dark", "--light", "--reduced-motion", "--quiet", "--check-motion"].includes(args[i - 1])));
  if (!entry) {
    console.error(SNAP_USAGE);
    return 2;
  }
  if (args.includes("--dark") || args.includes("--light")) setColorScheme(args.includes("--dark") ? "dark" : "light");
  if (args.includes("--reduced-motion")) setReducedMotion(true);
  const size = flag(args, "--size")?.split("x").map(Number);
  const scale = Number(flag(args, "--scale") ?? 2);
  let h: HeadlessCore | null = null;
  const open = (app: () => JSX.Element, options: RunOptions = {}) => {
    if (h) return; // a second run(): one app at a time
    h = new HeadlessCore({ width: size?.[0] ?? options.width ?? 800, height: size?.[1] ?? options.height ?? 600, scale });
    if (options.title) h.ui.title(options.title);
    mount(h.ui, app);
    return { ui: h.ui, quit() {}, onEvent: () => {} };
  };
  (globalThis as Record<symbol, unknown>)[SNAP] = open;
  const mod = await import(resolve(entry));
  if (!h) {
    // No run(): a component module.
    const component = mod.default ?? Object.values(mod).find((v) => typeof v === "function" && /^[A-Z]/.test((v as { name: string }).name));
    if (typeof component !== "function") {
      console.error(`mantou: ${entry} neither calls run() nor exports a component`);
      return 2;
    }
    open(component as () => JSX.Element);
  }
  const core = h as unknown as HeadlessCore;
  await settle(core);
  const scenes: Record<string, () => unknown> = mod.scenes ?? {};
  if (args.includes("--list-scenes")) {
    console.log(Object.keys(scenes).join("\n") || "(the entry exports no scenes)");
    return 0;
  }
  const scene = async (name: string) => {
    const s = scenes[name];
    if (!s) throw new Error(`no scene "${name}" (there are: ${Object.keys(scenes).join(", ") || "none"})`);
    await instant(() => s());
    await settle(core);
    settleAnimations(core);
  };
  try {
    const sceneName = flag(args, "--scene");
    if (sceneName) await scene(sceneName);
    settleAnimations(core);
    const scriptArg = flag(args, "--script");
    if (scriptArg) {
      const steps: Step[] = JSON.parse(scriptArg.trim().startsWith("[") ? scriptArg : await Bun.file(scriptArg).text());
      for (const step of steps) {
        if ("press" in step) core.press(step.press, step.mods);
        else if ("hover" in step) core.hover(step.hover);
        else if ("type" in step) {
          if (step.into !== undefined) core.press(step.into);
          core.type(step.type);
        } else if ("key" in step) core.key(step.key, step.mods);
        else if ("scroll" in step) core.scroll(step.scroll, step.dy ?? 0, step.dx ?? 0);
        else if ("wait" in step) core.step(step.wait);
        else if ("resize" in step) core.resize(step.resize[0], step.resize[1]);
        else if ("snap" in step) writeFileSync(step.snap, encodePng(core.capture()));
        else if ("tree" in step) writeTree(core, step.tree);
        else if ("scene" in step) await scene(step.scene);
        else throw new Error(`unknown step ${JSON.stringify(step)}`);
        await settle(core);
      }
    }
    const at = flag(args, "--at");
    if (at !== undefined) core.step(Number(at));
    else settleAnimations(core);
    const out = flag(args, "--out");
    if (out) writeFileSync(out, encodePng(core.capture()));
    const tree = flag(args, "--tree");
    if (tree) writeTree(core, tree);
    const strip = flag(args, "--strip");
    if (strip) writeFileSync(strip, encodePng(core.strip({ frames: Number(flag(args, "--frames") ?? 12), every: Number(flag(args, "--every") ?? 33), cols: Number(flag(args, "--cols") ?? 4) })));
    if (!args.includes("--quiet")) console.log(treeText(core.tree()));
    if (args.includes("--check-motion")) {
      const msArg = flag(args, "--check-motion");
      const ms = msArg && /^\d+$/.test(msArg) ? Number(msArg) : 1000;
      const findings = core.checkMotion(() => {}, { ms, allow: flag(args, "--allow")?.split(",") ?? [] });
      for (const f of findings) console.log(`motion: ${f.kind} ${f.node} at ${f.at} ms: ${f.detail}`);
      if (findings.length) return 1;
    }
    return 0;
  } catch (e) {
    console.error(`mantou snap: ${e instanceof Error ? e.message : e}`);
    return 1;
  } finally {
    core.free();
  }
}
