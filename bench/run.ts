// Mantou's benchmarks: each scenario runs in a process of its own (bench/*.bench.tsx, headless on the real core),
// prints its metrics, and this prints them as a table.
//
//   bun run bench                         all scenarios
//   bun run bench --only cells,list       some of them
//   bun run bench --json out.json         also write the results
//   bun run bench --compare base.json     and show the change from an earlier run (same machine!)
//   bun run bench --runs 5                runs per scenario, each in a fresh process (default 3; the median is kept)
//
// Timings vary between machines and runs: compare on one machine; CI only reports them (never fails on them).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Bun.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const only = opt("only")?.split(",");
const dir = import.meta.dir;
const root = join(dir, "..");
const names = readdirSync(dir).filter((f) => f.endsWith(".bench.tsx")).map((f) => f.replace(".bench.tsx", "")).sort();
const chosen = names.filter((n) => !only || only.some((o) => n.includes(o)));

type Results = Record<string, Record<string, number>>;
const results: Results = {};
let gpu = "";
// Each scenario runs `runs` times, each in a fresh process; a metric is the median of its runs.
const runs = Number(opt("runs") ?? 3);
for (const name of chosen) {
  const samples: Record<string, number>[] = [];
  for (let r = 0; r < runs; r++) {
    process.stderr.write(`bench: ${name} (${r + 1}/${runs})…\n`);
    const p = Bun.spawnSync(["bun", "--preload", join(root, "runtime/solid/preload.ts"), join(dir, `${name}.bench.tsx`)], { cwd: root, stderr: "pipe" });
    const out = p.stdout.toString();
    const line = out.split("\n").find((l) => l.startsWith("BENCH "));
    const g = out.split("\n").find((l) => l.startsWith("GPU "));
    if (g) gpu = g.slice(4);
    if (p.exitCode !== 0 || !line) {
      console.error(`bench: ${name} failed (${p.exitCode})\n${p.stderr.toString().slice(-2000)}`);
      process.exitCode = 1;
      break;
    }
    samples.push(JSON.parse(line.slice(6)));
  }
  if (samples.length === runs) results[name] = Object.fromEntries(Object.keys(samples[0]).map((k) => [k, median(samples.map((s) => s[k]))]));
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root }).stdout.toString().trim();
const meta = { date: new Date().toISOString(), commit, bun: Bun.version, platform: `${process.platform}-${process.arch}`, cpu: cpuName(), gpu };
const base = opt("compare") ? (JSON.parse(readFileSync(opt("compare")!, "utf8")) as { meta: typeof meta; results: Results }) : null;

// A Markdown table (it reads as text in a terminal, and renders in CI's job summary).
const lines = [`Mantou benchmarks · ${meta.commit} · median of ${runs} runs · Bun ${meta.bun} · ${meta.platform} · ${meta.cpu}${gpu ? ` · ${gpu}` : ""}`, ""];
lines.push(base ? `| scenario | metric | ${base.meta.commit} | now | change |` : "| scenario | metric | value |");
lines.push(base ? "|---|---|--:|--:|--:|" : "|---|---|--:|");
for (const [name, metrics] of Object.entries(results)) {
  for (const [k, v] of Object.entries(metrics)) {
    const was = base?.results[name]?.[k];
    if (!base) lines.push(`| ${name} | ${k} | ${v} |`);
    else lines.push(`| ${name} | ${k} | ${was ?? "–"} | ${v} | ${was ? change(was, v) : ""} |`);
  }
}
console.log(lines.join("\n"));
if (opt("json")) writeFileSync(opt("json")!, JSON.stringify({ meta, results }, null, 2));

function change(was: number, now: number): string {
  if (was === 0) return now === 0 ? "" : "new";
  const pct = ((now - was) / was) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function cpuName(): string {
  try {
    if (process.platform === "linux") return /model name\s*:\s*(.+)/.exec(readFileSync("/proc/cpuinfo", "utf8"))?.[1] ?? "";
    if (process.platform === "darwin") return Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"]).stdout.toString().trim();
  } catch {}
  return process.env.PROCESSOR_IDENTIFIER ?? "";
}
