// Style values: the public Style type, shorthands, and encoding to wire words.
import { StyleProp, Unit, type Color, type Length, type StylePropName, type WireStyle } from "./gen/protocol";

/** What apps write: every wire property, plus a few shorthands. */
export interface Style extends WireStyle {
  /** Sets paddingTop/Right/Bottom/Left. */
  padding?: Length;
  /** Sets marginTop/Right/Bottom/Left. */
  margin?: Length;
  /** Sets rowGap and columnGap. */
  gap?: Length;
}

const SHORTHANDS: Record<string, StylePropName[]> = {
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
  gap: ["rowGap", "columnGap"],
};

/** Expands shorthands into wire properties, in a stable order; later keys win. */
export function expandStyle(style: Style): Map<StylePropName, unknown> {
  const out = new Map<StylePropName, unknown>();
  for (const [key, value] of Object.entries(style)) {
    const props = SHORTHANDS[key] ?? (key in StyleProp ? [key as StylePropName] : null);
    if (!props) throw new Error(`mantou: unknown style property "${key}"`);
    for (const p of props) out.set(p, value);
  }
  return out;
}

const scratch = new DataView(new ArrayBuffer(4));
export function f32bits(v: number): number {
  scratch.setFloat32(0, v, true);
  return scratch.getUint32(0, true);
}
export function bitsf32(w: number): number {
  scratch.setUint32(0, w, true);
  return scratch.getFloat32(0, true);
}

/** Parses a colour into RGBA8 packed as r | g << 8 | b << 16 | a << 24. */
export function parseColor(c: Color): number {
  let r: number, g: number, b: number, a = 255;
  if (typeof c !== "string") {
    [r, g, b] = c;
    if (c.length === 4) a = Math.round((c[3] as number) * 255);
  } else if (c === "transparent") {
    return 0;
  } else {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
    if (!m) throw new Error(`mantou: unsupported colour "${c}" (use #rgb, #rrggbb, #rrggbbaa, transparent or [r, g, b, a])`);
    let hex = m[1];
    if (hex.length === 3) hex = [...hex].map((h) => h + h).join("");
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16);
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (clamp(r) | (clamp(g) << 8) | (clamp(b) << 16) | (clamp(a) << 24)) >>> 0;
}

export function formatColor(rgba: number): string {
  const h = (v: number) => (v & 255).toString(16).padStart(2, "0");
  return `#${h(rgba)}${h(rgba >>> 8)}${h(rgba >>> 16)}${h(rgba >>> 24)}`;
}

/** Encodes one property's value as wire words (after the property code). */
export function encodeValue(prop: StylePropName, value: unknown): number[] {
  const def = StyleProp[prop];
  switch (def.kind) {
    case "f32":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`mantou: ${prop} must be a finite number`);
      return [f32bits(value)];
    case "color":
      return [parseColor(value as Color)];
    case "length": {
      const v = value as Length;
      if (v === "auto") return [Unit.auto, 0];
      if (typeof v === "number" && Number.isFinite(v)) return [Unit.px, f32bits(v)];
      if (typeof v === "string" && /^-?\d+(\.\d+)?%$/.test(v)) return [Unit.percent, f32bits(parseFloat(v))];
      throw new Error(`mantou: ${prop} must be a number, "N%" or "auto" (got ${JSON.stringify(v)})`);
    }
    case "family":
      // The Ui turns family names into a FONT_FAMILY id before encoding.
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`mantou: ${prop} must be interned by the Ui first`);
      return [value];
    case "enum": {
      const i = (def as { values: readonly string[] }).values.indexOf(value as string);
      if (i < 0) throw new Error(`mantou: ${prop} must be one of ${(def as { values: readonly string[] }).values.join(", ")}`);
      return [i];
    }
  }
}

/** How many words a property's value takes. */
export function valueWords(prop: StylePropName): number {
  return StyleProp[prop].kind === "length" ? 2 : 1;
}
