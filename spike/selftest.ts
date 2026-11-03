// Window self-test (runs in the app Worker). Checks the exit criteria of
// the design (website: design/testing §12.5) and writes selftest-report.json;
// exit code 0 = all pass.
//
// Rules from §12.1: wait for conditions, not for time; assert counts, not
// durations (CPU % is reported for information and checked loosely).
import { MantouCore, type Stats } from "../runtime/core";
import { Counter } from "../examples/counter/Counter";
import { mount } from "../runtime/solid/mount";

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

  // 6. The counter (a Solid component) is laid out by the core and drawn as quads.
  mount(core.ui, Counter);
  const PLUS = [68, 46] as const, BOARD = [300, 200] as const;
  {
    const before = core.stats();
    await until("the counter's first frame", () => core.stats().quads >= 5 && core.stats().frames > before.frames, 5_000);
    const s = core.stats();
    const plus = core.nodeRect(core.hit(...PLUS));
    check("ops → tree → layout → quads", s.quads === 5 && s.opErrors === 0 && plus !== null && plus[2] - plus[0] === 88, {
      quads: s.quads, nodes: s.nodes, opErrors: s.opErrors, plusRect: plus, firstCommitOps: core.ui.lastCommitOps,
    });
  }

  // 7. A press hit-tested by the core reaches the handler, whose commit is drawn.
  {
    const before = core.stats();
    const sent = performance.now();
    core.testPointer("down", ...PLUS);
    core.testPointer("up", ...PLUS);
    await until("the new square is drawn", () => core.stats().quads === 6 && core.stats().frames > before.frames, 5_000);
    const ms = performance.now() - sent;
    const d = delta(before, core.stats());
    // The first square also sends the `dot` style's definition, and the count's text: 6 ops.
    check("press → handler → one commit → frame", d.presses === 1 && d.commits === 1 && core.ui.lastCommitOps === 6, {
      presses: d.presses, commits: d.commits, opsInCommit: core.ui.lastCommitOps, msPressToFrame: +ms.toFixed(1),
    });
    const missBefore = core.stats().presses;
    core.testPointer("down", ...BOARD);
    core.testPointer("up", ...BOARD);
    await sleep(100);
    check("no press without a listener", core.stats().presses === missBefore && core.stats().quads === 6, { presses: core.stats().presses - missBefore });
  }

  // 8. Typing into an input: the main thread edits and draws; JS gets the text, not the keys.
  {
    let root = core.ui.nodes.get(core.hit(...BOARD))!;
    while (root.parent) root = root.parent;
    const input = core.ui.input({ position: "absolute", top: 8, right: 24, width: 160, height: 24, backgroundColor: "#ffffff" });
    root.append(input);
    await until("the input is laid out", () => core.nodeRect(input.id) !== null, 5_000);
    const r = core.nodeRect(input.id)!;
    core.testPointer("down", (r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    core.testPointer("up", (r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    await until("the input has the focus", () => input.focused, 5_000);
    const before = core.stats();
    const keys = core.received.keyDown ?? 0;
    const commits = core.ui.commits;
    for (const ch of "hi") core.testKey(ch.codePointAt(0)!);
    await until("the text reaches JS", () => input.value === "hi", 5_000);
    await until("the text is drawn", () => core.stats().glyphs - before.glyphs === 2 && core.stats().frames > before.frames, 5_000);
    const d = delta(before, core.stats());
    check("typing in an input", (core.received.keyDown ?? 0) === keys && core.ui.commits === commits && d.frames >= 1, {
      value: input.value, keyDownsInJs: (core.received.keyDown ?? 0) - keys, commits: core.ui.commits - commits, frames: d.frames, glyphs: d.glyphs,
    });
  }

  // 9. A scroll view scrolls on the main thread while the Worker is blocked (design §9.4).
  {
    let root = core.ui.nodes.get(core.hit(...BOARD))!;
    while (root.parent) root = root.parent;
    const view = core.ui.view({ position: "absolute", left: 24, bottom: 8, width: 160, height: 60, overflow: "scroll", backgroundColor: "#ffffff" });
    const rows = Array.from({ length: 20 }, () => core.ui.view({ height: 20, flexShrink: 0, backgroundColor: "#dbeafe" }));
    for (const r of rows) view.append(r);
    root.append(view);
    await until("the scroll view is laid out", () => core.nodeRect(rows[0].id) !== null, 5_000);
    const r = core.nodeRect(view.id)!;
    const top0 = core.nodeRect(rows[0].id)![1];
    const before = core.stats();
    for (let i = 0; i < 5; i++) core.testWheel((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 40);
    // The Worker stays blocked (it never yields) until the main thread has
    // scrolled all five turns, reading positions from the core synchronously.
    const giveUp = performance.now() + 10_000;
    let moved = 0;
    while ((moved = top0 - core.nodeRect(rows[0].id)![1]) < 200 && performance.now() < giveUp) {}
    while (core.stats().frames === before.frames && performance.now() < giveUp) {}
    const d = delta(before, core.stats());
    check("scrolling without JS", moved === 200 && d.commits === 0 && d.frames >= 1, {
      scrolledPx: moved, commitsWhileBlocked: d.commits, framesWhileBlocked: d.frames,
    });
    root.remove(view);
    view.release();
    for (const row of rows) row.release();
  }

  // 10. Resizes lay out on the main thread while the Worker is blocked.
  {
    await sleep(200);
    const before = core.stats();
    core.testResize(8, 50, [800, 520], [640, 400]);
    const spinUntil = performance.now() + 800;
    while (performance.now() < spinUntil) {}
    const d = delta(before, core.stats());
    check("relayout without JS", d.layouts >= 4 && d.commits === 0 && d.frames >= 4, {
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
