// Window self-test (runs in the app Worker). Checks the exit criteria of
// the design (website: design/testing §12.5) and writes selftest-report.json;
// exit code 0 = all pass.
//
// Rules from §12.1: wait for conditions, not for time; assert counts, not
// durations (CPU % is reported for information and checked loosely).
import { MantouCore, type Stats } from "../runtime/core";
import { Counter } from "../examples/counter/Counter";
import { mount } from "../runtime/solid/mount";
import { openWindow } from "../runtime/windows";
import { View } from "../runtime/solid/components";
import { STAT_NAMES, statsFrom } from "../runtime/events";
import { onError, type AppError } from "../runtime/errors";
import { monitors, type WindowInfo } from "../runtime/platform";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    // The cursor follows the pointer on the main thread: the text cursor over the input.
    core.testPointer("move", (r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    await until("the text cursor over the input", () => core.cursor() === "text", 5_000);
    core.testPointer("move", ...BOARD);
    await until("the arrow off it", () => core.cursor() === "default", 5_000);
    check("cursor over an input", true, { over: "text", off: "default" });
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
    // Look every 5 ms, not in a tight loop: each look takes the tree's lock,
    // and a Worker hammering it can starve the main thread (macOS's mutexes
    // aren't fair), which would be the test's fault, not the core's.
    const giveUp = performance.now() + 10_000;
    const every = (ms: number, done: () => boolean) => {
      let next = 0;
      while (performance.now() < giveUp) {
        if (performance.now() < next) continue;
        if (done()) return;
        next = performance.now() + ms;
      }
    };
    let moved = 0;
    every(5, () => (moved = top0 - core.nodeRect(rows[0].id)![1]) >= 200);
    every(5, () => core.stats().frames > before.frames);
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

  // 11. An animation runs on the main thread while the Worker is blocked, then the window goes idle (design §9.4).
  {
    let root = core.ui.nodes.get(core.hit(...BOARD))!;
    while (root.parent) root = root.parent;
    const box = core.ui.view({ position: "absolute", left: 24, top: 8, width: 40, height: 40, backgroundColor: "#f59e0b" });
    root.append(box);
    await until("the box is laid out", () => core.nodeRect(box.id) !== null, 5_000);
    const x0 = core.nodeRect(box.id)![0];
    const a = box.animate("translateX", { from: 0, to: 200, duration: 500, easing: "linear" });
    core.ui.flush();
    const before = core.stats();
    const spinUntil = performance.now() + 300;
    while (performance.now() < spinUntil) {}
    const during = delta(before, core.stats());
    const moved = core.nodeRect(box.id)![0] - x0;
    let ended = false;
    a.finished.then(() => (ended = true));
    await until("the animation ends", () => ended, 5_000);
    await sleep(100);
    const after = core.stats();
    await sleep(500);
    const idle = delta(after, core.stats());
    check("animating without JS, then idle", during.frames >= 5 && during.commits === 0 && moved > 0 && idle.frames === 0, {
      framesWhileBlocked: during.frames, commitsWhileBlocked: during.commits, movedPx: Math.round(moved), framesAfterEnd: idle.frames,
    });
    root.remove(box);
    box.release();
  }

  // 12. Another window: it opens and draws, one turn commits to both, and closing it leaves the first running.
  {
    const statsOf = (id: number) => {
      const a = new BigUint64Array(STAT_NAMES.length);
      core.lib.symbols.mt_stats(id, a, a.length);
      return statsFrom(a);
    };
    let ready2 = false;
    const second = openWindow(() => View({ style: { flexGrow: 1, backgroundColor: "#16a34a" } }), { title: "Second", width: 240, height: 160 });
    second.ui.onResize(() => (ready2 = true));
    await until("the second window opened", () => ready2, 10_000);
    await until("the second window's first frame", () => statsOf(second.id).frames >= 1, 10_000);
    const [a0, b0] = [core.stats(), statsOf(second.id)];
    // One turn, both windows: one commit each.
    core.clearColor(0.3, 0.2, 0.5, 1);
    second.ui.clearColor(0.1, 0.4, 0.2, 1);
    await until("both drew", () => core.stats().frames > a0.frames && statsOf(second.id).frames > b0.frames, 10_000);
    const both = { first: core.stats().commits - a0.commits, second: statsOf(second.id).commits - b0.commits };
    second.close();
    const a1 = core.stats();
    core.clearColor(0.2, 0.5, 0.8, 1);
    await until("the first window still draws", () => core.stats().frames > a1.frames, 10_000);
    check("a second window", both.first === 1 && both.second === 1 && second.closed, { commitsInOneTurn: both, closed: second.closed });
  }

  // 13. Errors: a throw in a timer, a rejection, a throw in an event handler (the wake-up's drain) and a
  // panic the core recovers from all reach onError; handled, the app runs on and the window draws.
  {
    const dir = mkdtempSync(join(tmpdir(), "mantou-selftest-"));
    const b = new TextEncoder().encode(dir);
    core.lib.symbols.mt_set_crash_dir(b, b.byteLength);
    const seen: AppError[] = [];
    const off = onError((e) => {
      seen.push(e);
      return true;
    });
    const onEvent = core.onEvent;
    core.onEvent = (e) => {
      onEvent(e);
      if (e.type === "coreError") throw new Error("from an event handler");
    };
    setTimeout(() => { throw new Error("from a timer"); });
    void Promise.reject(new Error("rejected"));
    core.lib.symbols.mt_test_panic(core.handle);
    await until("four errors", () => seen.length >= 4, 10_000);
    const a = core.stats();
    core.clearColor(0.2, 0.5, 0.8, 1);
    await until("the window draws after the errors", () => core.stats().frames > a.frames, 10_000);
    const kinds = seen.map((e) => `${e.kind}: ${e.message}`).sort();
    const reports = readdirSync(dir);
    check("errors reach onError, the app runs on",
      JSON.stringify(kinds) === JSON.stringify(["core: test panic", "error: Error: from a timer", "error: Error: from an event handler", "rejection: Error: rejected"]) &&
        reports.length === 1 && seen.some((e) => e.kind === "core" && e.report === join(dir, reports[0])),
      { kinds, reports: reports.length });
    core.onEvent = onEvent;
    off();
    rmSync(dir, { recursive: true, force: true });
  }

  // 14. A drag's preview (FOLLOW_POINTER) moves with the pointer on the main thread while the Worker is blocked.
  {
    let root = core.ui.nodes.get(core.hit(...BOARD))!;
    while (root.parent) root = root.parent;
    const ghost = core.ui.view({ position: "fixed", left: 0, top: 0, width: 60, height: 30, pointerEvents: "none", backgroundColor: "#2563eb" });
    root.append(ghost);
    core.testPointer("move", 100, 100);
    core.ui.enc.followPointer(ghost.id, 10, 10);
    core.ui.flush();
    await until("the preview is at the pointer", () => core.nodeRect(ghost.id)?.[0] === 90, 5_000);
    const before = core.stats();
    for (let i = 1; i <= 20; i++) core.testPointer("move", 100 + i * 10, 100 + i * 5);
    const spinUntil = performance.now() + 600;
    while (performance.now() < spinUntil) {}
    const d = delta(before, core.stats());
    const r = core.nodeRect(ghost.id);
    check("a drag preview follows the pointer without JS", d.commits === 0 && d.frames >= 1 && r?.[0] === 290 && r?.[1] === 190, {
      at: r && [r[0], r[1]], commitsWhileBlocked: d.commits, framesWhileBlocked: d.frames,
    });
    core.ui.enc.followPointer(0, 0, 0);
    root.remove(ghost);
    ghost.release();
    core.ui.flush();
  }

  // 15. Displays: the window is on one of them, and a window asked to open off every display opens on one.
  {
    const list = await monitors();
    const current = list.filter((m) => m.current);
    let ready2 = false;
    const lost = openWindow(() => View({ style: { flexGrow: 1 } }), { title: "Lost", width: 200, height: 120, x: -20000, y: -20000 });
    lost.ui.onResize(() => (ready2 = true));
    await until("the window asked to open off-screen opened", () => ready2, 10_000);
    const s = await lost.ui.service<WindowInfo>({ kind: "window", op: "state" });
    lost.close();
    const onOne = !!s && list.some((m) => s.x + 40 > m.x && s.x < m.x + m.width && s.y >= m.y - 8 && s.y < m.y + m.height);
    check("displays", list.length >= 1 && current.length === 1 && list.every((m) => m.width > 0 && m.height > 0 && m.scale > 0) && onOne, {
      displays: list.map((m) => `${m.name || "?"} ${m.width}x${m.height}@${m.scale} at ${m.x},${m.y}${m.primary ? " primary" : ""}${m.current ? " current" : ""}`),
      offScreenWindowAt: s && [s.x, s.y],
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
