// Window self-test (runs in the app Worker). Checks the exit criteria of
// M0 and M1 (DESIGN.md §13, §12.5) and writes m0-report.json; exit code 0 = all pass.
//
// Rules from §12.1: wait for conditions, not for time; assert counts, not
// durations (CPU % is reported for information and checked loosely).
import { MantouCore, type Stats } from "../runtime/core";
import { counter } from "../examples/counter/counter";

const core = new MantouCore();
type Check = { name: string; pass: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const t0 = Number(process.env.MANTOU_T0 ?? Date.now());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delta = (a: Stats, b: Stats) =>
  Object.fromEntries(Object.keys(a).map((k) => [k, b[k as keyof Stats] - a[k as keyof Stats]])) as unknown as Stats;

async function until(what: string, cond: () => boolean, guardMs = 20_000) {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > guardMs) throw new Error(`never happened: ${what}`);
    await sleep(2);
  }
  return performance.now() - start;
}

function check(name: string, pass: boolean, detail: Record<string, unknown>) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
}

let ready: { width: number; height: number; scale: number } | undefined;
let resizedEvents = 0;
core.onEvent = (e) => {
  if (e.type === "windowReady") ready = e;
  if (e.type === "resized") resizedEvents++;
};

async function main() {
  core.ready();

  // 1. The event loop runs on Bun's main thread, a window opens, a frame is drawn.
  await until("the window opened", () => ready !== undefined);
  await until("the first frame was presented", () => core.stats().frames >= 1);
  check("window + first frame on the main thread", true, {
    ...ready, gpu: core.info(), msSinceLaunch: Date.now() - t0,
  });

  // 2. A commit from the Worker reaches the screen.
  {
    await sleep(200);
    const before = core.stats();
    const sent = performance.now();
    core.clearColor(0.2, 0.5, 0.8, 1);
    await until("a frame after the commit", () => core.stats().frames > before.frames, 5_000);
    const d = delta(before, core.stats());
    check("commit → frame", d.commits === 1 && d.frames >= 1, {
      commits: d.commits, frames: d.frames, msToFrame: +(performance.now() - sent).toFixed(1),
    });
  }

  // 3. Idle: nothing changes for 3 s → no frames, no wake-ups, ~0% CPU.
  {
    await sleep(500);
    const before = core.stats();
    const cpu0 = process.cpuUsage();
    const wall0 = performance.now();
    await sleep(3000);
    const cpu = process.cpuUsage(cpu0);
    const wallMs = performance.now() - wall0;
    const d = delta(before, core.stats());
    const cpuPct = ((cpu.user + cpu.system) / 1000 / wallMs) * 100;
    check("idle: no frames, no wake-ups", d.frames === 0 && d.wakes === 0 && d.commits === 0 && cpuPct < 3, {
      seconds: +(wallMs / 1000).toFixed(2), frames: d.frames, wakes: d.wakes, commits: d.commits,
      cpuPercentOfOneCore: +cpuPct.toFixed(3),
    });
  }

  // 4. Live resize while the Worker does network I/O and runs timers.
  {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const before = core.stats();
    const resized0 = resizedEvents;
    let ticks = 0, fetched = 0, failed = 0;
    const timer = setInterval(() => ticks++, 10);
    const started = performance.now();
    core.testResize(20, 40, [700, 450], [560, 360]);
    const fetching = (async () => {
      while (performance.now() - started < 1200) {
        try {
          const r = await fetch(`http://localhost:${server.port}/`);
          (await r.text()) === "ok" ? fetched++ : failed++;
        } catch { failed++; }
      }
    })();
    await until("20 resizes", () => core.stats().resizes - before.resizes >= 20, 10_000).catch(() => {});
    await fetching;
    clearInterval(timer);
    server.stop(true);
    const elapsed = performance.now() - started;
    const d = delta(before, core.stats());
    const expectedTicks = Math.floor(elapsed / 10);
    check("live resize + fetch + timers", d.resizes >= 10 && d.frames >= 10 && resizedEvents - resized0 >= 10 &&
      fetched >= 10 && failed === 0 && ticks >= expectedTicks * 0.5, {
      resizes: d.resizes, frames: d.frames, resizeEventsInJs: resizedEvents - resized0,
      fetched, failed, timerTicks: ticks, expectedTicks, ms: Math.round(elapsed),
    });
  }

  // 5. The Worker is blocked for 1 s: the main thread keeps drawing, and wake-ups coalesce.
  {
    await sleep(300);
    const before = core.stats();
    const resized0 = resizedEvents;
    core.testResize(12, 50, [640, 400], [720, 480]);
    const spinUntil = performance.now() + 1000;
    while (performance.now() < spinUntil) {} // no JS runs on this thread for 1 s
    const during = delta(before, core.stats());
    await sleep(100); // let the queued wake-up run
    const inJs = resizedEvents - resized0;
    check("Worker blocked: frames continue, one wake-up", during.frames >= 5 && during.wakes <= 1 && inJs >= 5, {
      framesWhileBlocked: during.frames, resizesWhileBlocked: during.resizes, wakesWhileBlocked: during.wakes,
      resizeEventsDeliveredAfter: inJs,
    });
  }

  // 6. M1: the counter's tree is laid out by the core and drawn as quads.
  const c = counter(core.ui);
  {
    const before = core.stats();
    await until("the counter's first frame", () => core.stats().quads >= 5 && core.stats().frames > before.frames, 5_000);
    const s = core.stats();
    const plus = core.nodeRect(c.plus.id);
    check("M1: ops → tree → layout → quads", s.quads === 5 && s.opErrors === 0 && plus !== null && plus[2] - plus[0] === 88, {
      quads: s.quads, nodes: s.nodes, opErrors: s.opErrors, ops: s.ops, plusRect: plus, firstCommitOps: core.ui.lastCommitOps,
    });
  }

  // 7. M1: a press hit-tested by the core reaches the handler, whose commit is drawn.
  {
    const [x0, y0, x1, y1] = core.nodeRect(c.plus.id)!;
    const before = core.stats();
    const sent = performance.now();
    core.testPointer("down", (x0 + x1) / 2, (y0 + y1) / 2);
    core.testPointer("up", (x0 + x1) / 2, (y0 + y1) / 2);
    await until("the new square is drawn", () => core.stats().quads === 6 && core.stats().frames > before.frames, 5_000);
    const ms = performance.now() - sent;
    const d = delta(before, core.stats());
    check("M1: press → handler → one commit → frame", c.count() === 1 && d.presses === 1 && d.commits === 1 && core.ui.lastCommitOps === 4, {
      count: c.count(), presses: d.presses, commits: d.commits, opsInCommit: core.ui.lastCommitOps, msPressToFrame: +ms.toFixed(1),
    });
    // A press that misses every listener reaches nobody.
    const missBefore = core.stats().presses;
    const board = core.nodeRect(c.board.id)!;
    core.testPointer("down", board[0] + 4, board[1] + 4);
    core.testPointer("up", board[0] + 4, board[1] + 4);
    await sleep(100);
    check("M1: no press without a listener", core.stats().presses === missBefore && c.count() === 1, { presses: core.stats().presses - missBefore });
  }

  // 8. M1: resizes lay out on the main thread while the Worker is blocked.
  {
    await sleep(200);
    const before = core.stats();
    core.testResize(8, 50, [800, 520], [640, 400]);
    const spinUntil = performance.now() + 800;
    while (performance.now() < spinUntil) {}
    const d = delta(before, core.stats());
    check("M1: relayout without JS", d.layouts >= 4 && d.commits === 0 && d.frames >= 4, {
      layoutsWhileBlocked: d.layouts, commitsWhileBlocked: d.commits, framesWhileBlocked: d.frames,
    });
  }
}

let code = 0;
try {
  await main();
} catch (err) {
  check("self-test ran to completion", false, { error: String(err) });
}
const failed = checks.filter((c) => !c.pass);
code = failed.length ? 1 : 0;
const report = {
  bun: Bun.version, platform: `${process.platform}-${process.arch}`, gpu: core.info(),
  rssMB: +(process.memoryUsage().rss / 2 ** 20).toFixed(1), stats: core.stats(), checks,
  result: code === 0 ? "pass" : "fail",
};
await Bun.write("selftest-report.json", JSON.stringify(report, null, 2));
console.log(`\nSelf-test: ${report.result.toUpperCase()} (${checks.length - failed.length}/${checks.length}) · RSS ${report.rssMB} MB · ${report.gpu}`);
core.quit(code);
