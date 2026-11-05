// The window config `mt_run` and `mt_window_open` take: 10 u32 words (sizes in
// logical px, 0 = no limit; WindowFlag bits; x, y) and then the title's UTF-8.
import { WindowFlag } from "./gen/protocol";
import type { WindowOptions } from "./main";

export function encodeWindowConfig(o: WindowOptions & { width: number; height: number }, title: string): Uint8Array {
  const t = new TextEncoder().encode(title);
  const cfg = new Uint8Array(40 + t.length);
  const placed = o.x !== undefined && o.y !== undefined;
  new Uint32Array(cfg.buffer, 0, 10).set([
    o.width,
    o.height,
    t.length,
    o.minWidth ?? 0,
    o.minHeight ?? 0,
    o.maxWidth ?? 0,
    o.maxHeight ?? 0,
    (o.resizable === false ? WindowFlag.NotResizable : 0) |
      (o.frameless ? WindowFlag.Frameless : 0) |
      (o.alwaysOnTop ? WindowFlag.AlwaysOnTop : 0) |
      (o.titleBar === "overlay" ? WindowFlag.TitleOverlay : 0) |
      (o.fullscreen ? WindowFlag.Fullscreen : 0) |
      (o.maximized ? WindowFlag.Maximized : 0) |
      (placed ? WindowFlag.HasPosition : 0),
    placed ? o.x! | 0 : 0,
    placed ? o.y! | 0 : 0,
  ]);
  cfg.set(t, 40);
  return cfg;
}
