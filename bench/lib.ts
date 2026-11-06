// Helpers for the benchmark scenarios (bench/*.bench.tsx): timing with warm-up, and reporting one JSON line
// to the runner (bench/run.ts). Times are wall-clock ms on this machine: compare runs on the same machine.
import type { Stats } from "../runtime/events";

/** Median, 95th percentile and minimum of some samples (ms). */
export function summary(samples: number[]): { median: number; p95: number; min: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95), min: s[0] };
}

/** Times `fn` `iterations` times after `warmup` untimed runs; the samples, ms. */
export function time(fn: (i: number) => void, iterations: number, warmup = 5): number[] {
  for (let i = 0; i < warmup; i++) fn(i);
  const out: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn(warmup + i);
    out.push(performance.now() - t);
  }
  return out;
}

/** The core's counters between two `stats()` readings. */
export function delta(a: Stats, b: Stats): Stats {
  return Object.fromEntries(Object.keys(a).map((k) => [k, b[k as keyof Stats] - a[k as keyof Stats]])) as unknown as Stats;
}

export type Metrics = Record<string, number>;

/**
 * Prints the scenario's metrics for the runner. Keys end in their unit: "frame ms", "rss MB", "ops". The process's
 * memory at the end is added: its resident set (everything: Bun, the core, the GPU driver) and the JS heap.
 */
export function report(metrics: Metrics) {
  const m = process.memoryUsage();
  const all = { ...metrics, "rss at the end MB": m.rss / 2 ** 20, "JS heap at the end MB": m.heapUsed / 2 ** 20 };
  const rounded = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  console.log("BENCH " + JSON.stringify(rounded));
}

export const rssMB = () => process.memoryUsage().rss / 2 ** 20;

/** Memory after a full garbage collection, MB: the resident set and the JS heap. */
export function memory(): { rss: number; heap: number } {
  Bun.gc(true);
  const m = process.memoryUsage();
  return { rss: m.rss / 2 ** 20, heap: m.heapUsed / 2 ** 20 };
}

/** A frame's cost from the core's counters, ms per frame: where the time went. */
export function breakdown(d: Stats, frames: number): Metrics {
  return {
    "apply ms/frame": d.applyMicros / 1000 / frames,
    "layout ms/frame": d.layoutMicros / 1000 / frames,
    "scene ms/frame": d.sceneMicros / 1000 / frames,
  };
}
