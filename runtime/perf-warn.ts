// Performance warnings for `mantou dev`: patterns in the core's counters that mean the app is doing work the
// framework would do better, said once each, with what to do instead. MANTOU_PERF_WARN=0 turns them off.
import type { Stats } from "./events";

export interface PerfWarning {
  kind: "js-animation" | "slow-frames" | "op-errors" | "many-nodes";
  message: string;
}

/** What `now` says against `before`, `ms` apart (a window of a second or two). */
export function perfWarnings(before: Stats, now: Stats, ms: number): PerfWarning[] {
  const out: PerfWarning[] = [];
  const frames = now.frames - before.frames, commits = now.commits - before.commits;
  const perSecond = (n: number) => Math.round((n * 1000) / ms);
  if (frames >= 30 && commits >= frames * 0.8) {
    out.push({
      kind: "js-animation",
      message: `the app commits a change almost every frame (${perSecond(commits)} commits a second): if it animates from a timer or requestAnimationFrame, use \`transition\` or \`node.animate()\`, which run in the core with no JS per frame`,
    });
  }
  if (frames >= 10) {
    const per = (k: "applyMicros" | "layoutMicros" | "sceneMicros" | "renderMicros") => (now[k] - before[k]) / frames / 1000;
    const total = per("applyMicros") + per("layoutMicros") + per("sceneMicros") + per("renderMicros");
    if (total > 12) {
      const f = (n: number) => n.toFixed(1);
      out.push({
        kind: "slow-frames",
        message: `frames take ${f(total)} ms in the core (applying ops ${f(per("applyMicros"))}, layout ${f(per("layoutMicros"))}, scene ${f(per("sceneMicros"))}, drawing ${f(per("renderMicros"))}): long lists belong in <List>, and colour or transform changes shouldn't touch layout styles`,
      });
    }
  }
  if (now.opErrors > before.opErrors) out.push({ kind: "op-errors", message: `${now.opErrors - before.opErrors} ops failed in the core (see the errors above)` });
  if (now.nodes > 20_000 && before.nodes <= 20_000) out.push({ kind: "many-nodes", message: `the tree has ${now.nodes} nodes: show long lists with <List>, which only makes the rows that show` });
  return out;
}
