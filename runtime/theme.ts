// The system's colour scheme as a signal, and themes whose values follow it.
import { watchLinuxScheme } from "./linux-scheme";
import { activeUi } from "./platform";
import { createSignal } from "./solid/solid";
import type { Ui } from "./ui";

export type ColorScheme = "light" | "dark";

const [system, setSystem] = createSignal<ColorScheme>("light");
const [forced, setForced] = createSignal<ColorScheme | null>(null);
let hooked: Ui | null = null;

/** Follows the mounted app's window the first time it is needed. */
function follow() {
  const ui = activeUi();
  if (!ui || ui === hooked) return;
  hooked = ui;
  // On Linux the window doesn't know (winit doesn't report it): the desktop portal's answer wins when there is one
  // (dunkbing/mantou#79).
  let desktop: ColorScheme | null = null;
  if (process.platform === "linux") watchLinuxScheme((s) => setSystem((desktop = s)));
  setSystem(desktop ?? (ui.windowState.dark ? "dark" : "light"));
  ui.onWindowState((s) => setSystem(desktop ?? (s.dark ? "dark" : "light")));
}

/** The colour scheme in use, as a signal: the system's, unless `setColorScheme` chose one. */
export function useColorScheme(): () => ColorScheme {
  follow();
  // A theme made before the window exists looks for one on each read (cheap once it has).
  return () => {
    follow();
    return forced() ?? system();
  };
}

/** Forces "light" or "dark" (an in-app setting), or "system" to follow the OS again. */
export function setColorScheme(scheme: ColorScheme | "system") {
  setForced(scheme === "system" ? null : scheme);
}

/**
 * A theme: one set of values per scheme. What it returns reads the current scheme whenever a value is
 * read, so `style={{ backgroundColor: theme.bg }}` changes with the scheme and nothing else needs to.
 */
export function defineTheme<T extends Record<string, string | number>>(theme: { light: T; dark: T }): T {
  const scheme = useColorScheme();
  const out = {} as T;
  for (const key of Object.keys(theme.light) as (keyof T)[]) {
    Object.defineProperty(out, key, { enumerable: true, get: () => theme[scheme()][key] });
  }
  return out;
}
