// Interactive M0 demo (runs in the app Worker).
//   click        → new background colour
//   any key      → shows the key in the title
//   Escape/close → quit
// Every 2 s it fetches from a local server and runs a timer, to show Bun's I/O
// keeps working while the main thread is inside the native loop; it does not
// redraw for that, so the window stays idle in between.
import { MantouCore } from "../runtime/core";

const core = new MantouCore();
const server = Bun.serve({ port: 0, fetch: () => new Response(String(Date.now())) });
let clicks = 0, fetches = 0, ticks = 0;

const hue = (h: number): [number, number, number] => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 0.5 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const show = (extra = "") => core.title(`Mantou M0 · clicks ${clicks} · fetches ${fetches} · ticks ${ticks}${extra}`);

core.onEvent = (e) => {
  switch (e.type) {
    case "windowReady":
      console.log(`window ${e.width}x${e.height} @${e.scale}x · GPU: ${core.info()}`);
      show();
      break;
    case "pointerDown":
      clicks++;
      core.clearColor(...hue(clicks * 47), 1);
      show();
      break;
    case "keyDown":
      if (e.key === "Escape") return core.quit(0);
      show(` · key ${e.key}`);
      break;
    case "closeRequested":
      console.log("stats", core.stats());
      core.quit(0);
      break;
  }
};

setInterval(async () => {
  ticks++;
  const r = await fetch(`http://localhost:${server.port}/`);
  if (r.ok) fetches++, await r.text();
}, 2000);

core.ready();
