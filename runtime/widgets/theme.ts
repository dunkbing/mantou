// The base widgets' colours as named tokens that follow the current theme (light unless the app sets another).
import { useColorScheme } from "../theme";
import { createSignal } from "../solid/solid";

export interface Theme {
  /** The window's backdrop. */
  background: string;
  /** Dialogs, menus, popups. */
  surface: string;
  /** Table header and stripes. */
  surfaceAlt: string;
  /** Inputs and unchecked boxes. */
  control: string;
  controlHover: string;
  controlPressed: string;
  /** Selected or active rows and options. */
  selected: string;
  /** Outlines of controls. */
  border: string;
  borderHover: string;
  /** Thin rules (tabs, tables, menus, the splitter). */
  divider: string;
  /** Slider and progress tracks, an off toggle. */
  track: string;
  text: string;
  dimText: string;
  placeholder: string;
  accent: string;
  accentHover: string;
  accentPressed: string;
  /** Text on the accent. */
  accentText: string;
  /** A hovered splitter. */
  accentSoft: string;
  /** Slider and toggle knobs. */
  knob: string;
  /** Tooltips and toasts. */
  inverse: string;
  inverseText: string;
}

export const light: Theme = {
  background: "#ffffff", surface: "#ffffff", surfaceAlt: "#f9fafb", control: "#ffffff", controlHover: "#f3f4f6", controlPressed: "#d1d5db", selected: "#e0e7ff",
  border: "#9ca3af", borderHover: "#6b7280", divider: "#e5e7eb", track: "#d1d5db", text: "#111827", dimText: "#4b5563", placeholder: "#9ca3af",
  accent: "#2563eb", accentHover: "#1d4ed8", accentPressed: "#1e40af", accentText: "#ffffff", accentSoft: "#bfdbfe", knob: "#ffffff", inverse: "#111827", inverseText: "#ffffff",
};

export const dark: Theme = {
  background: "#111827", surface: "#1f2937", surfaceAlt: "#18212f", control: "#1f2937", controlHover: "#374151", controlPressed: "#4b5563", selected: "#1e3a8a",
  border: "#6b7280", borderHover: "#9ca3af", divider: "#374151", track: "#4b5563", text: "#f3f4f6", dimText: "#9ca3af", placeholder: "#6b7280",
  accent: "#3b82f6", accentHover: "#60a5fa", accentPressed: "#2563eb", accentText: "#ffffff", accentSoft: "#1e40af", knob: "#f9fafb", inverse: "#f3f4f6", inverseText: "#111827",
};

type Choice = Theme | "light" | "dark" | "system";
const [choice, setChoice] = createSignal<Choice>("light");

/**
 * Picks the widgets' theme: "light" (the default), "dark", "system" (follows the OS), or your own tokens
 * (spread `light` or `dark` and change some). Everything reading `theme` updates.
 */
export function setTheme(t: Choice | Partial<Theme>) {
  setChoice(typeof t === "string" ? t : { ...light, ...t });
}

/** The tokens in effect now, as a signal. */
function current(): Theme {
  const c = choice();
  return c === "light" ? light : c === "dark" ? dark : c === "system" ? (useColorScheme()() === "dark" ? dark : light) : c;
}

/** The current theme's tokens: each read follows `setTheme` (so it's reactive inside styles). */
export const theme = {} as Theme;
for (const key of Object.keys(light) as (keyof Theme)[]) Object.defineProperty(theme, key, { enumerable: true, get: () => current()[key] });
