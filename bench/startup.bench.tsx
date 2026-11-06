// Startup: from the process starting to the counter's first laid-out frame, and its first frame drawn (headless).
// Each step is the time since the process started, ms.
const atStart = performance.now(); // Bun, then the JSX preload (Babel)
const ui = await import("mantou-ui");
const imported = performance.now();
const { HeadlessCore } = await import("../runtime/headless");
const h = new HeadlessCore({ width: 400, height: 300 });
const opened = performance.now();
const { Counter } = await import("../examples/counter/Counter");
ui.mount(h.ui, () => <Counter />);
h.step();
const laidOut = performance.now();
h.capture();
const drawn = performance.now();
const { report } = await import("./lib");
report({
  "Bun and the JSX plugin ms": atStart,
  "mantou-ui imported ms": imported,
  "core loaded, instance made ms": opened,
  "first frame laid out ms": laidOut,
  "first frame drawn ms": drawn,
});
h.free();

export {}; // a module: top-level await, and dynamic imports so each step is timed
