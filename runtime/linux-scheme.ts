// The desktop's light or dark preference on Linux, which winit doesn't report (dunkbing/mantou#79): read from
// the XDG desktop portal (GNOME, KDE Plasma and others publish it there) with `gdbus`, followed through its
// SettingChanged signal, with GNOME's own settings as a fallback. MANTOU_COLOR_SCHEME=dark (or light) overrides.

/** A portal answer or signal's `color-scheme` value: 1 prefers dark, 2 prefers light, 0 (or none) no preference. */
export function parsePortalScheme(text: string): "dark" | "light" | null {
  const m = /color-scheme'?,?\s*<*\s*uint32 (\d)|uint32 (\d)/.exec(text);
  const v = m ? Number(m[1] ?? m[2]) : 0;
  return v === 1 ? "dark" : v === 2 ? "light" : null;
}

/** GNOME's settings: `color-scheme` ('prefer-dark'), else a GTK theme named …-dark. */
export function parseGnomeScheme(colorScheme: string | null, gtkTheme: string | null): "dark" | "light" | null {
  if (colorScheme?.includes("prefer-dark")) return "dark";
  if (colorScheme?.includes("prefer-light")) return "light";
  if (gtkTheme && /-dark'?\s*$/i.test(gtkTheme.trim())) return "dark";
  return colorScheme || gtkTheme ? "light" : null;
}

async function read(cmd: string[]): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

const PORTAL = ["--session", "--dest", "org.freedesktop.portal.Desktop", "--object-path", "/org/freedesktop/portal/desktop"];

/** The preference now: the portal's, else GNOME's; null when nothing says. */
export async function linuxScheme(): Promise<"dark" | "light" | null> {
  const env = process.env.MANTOU_COLOR_SCHEME;
  if (env === "dark" || env === "light") return env;
  const portal = await read(["gdbus", "call", ...PORTAL, "--method", "org.freedesktop.portal.Settings.Read", "org.freedesktop.appearance", "color-scheme"]);
  const fromPortal = portal ? parsePortalScheme(portal) : null;
  if (fromPortal) return fromPortal;
  const [cs, gtk] = await Promise.all([read(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"]), read(["gsettings", "get", "org.gnome.desktop.interface", "gtk-theme"])]);
  return parseGnomeScheme(cs, gtk) ?? (portal ? "light" : null);
}

/** Calls `set` with the preference now and whenever the desktop changes it. Once per process. */
let watching = false;
export function watchLinuxScheme(set: (scheme: "dark" | "light") => void) {
  if (watching) return;
  watching = true;
  void linuxScheme().then((s) => s && set(s));
  if (process.env.MANTOU_COLOR_SCHEME) return;
  try {
    const p = Bun.spawn(["gdbus", "monitor", ...PORTAL], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    p.unref(); // it doesn't keep the app running
    void (async () => {
      let buffered = "";
      for await (const chunk of p.stdout as unknown as AsyncIterable<Uint8Array>) {
        buffered += new TextDecoder().decode(chunk);
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.includes("SettingChanged") || !line.includes("color-scheme")) continue;
          const s = parsePortalScheme(line);
          set(s ?? "light");
        }
      }
    })().catch(() => {});
  } catch {} // no gdbus: the preference at start is all there is
}
