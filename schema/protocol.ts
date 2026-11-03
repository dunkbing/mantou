// The wire protocol between the Worker (TypeScript) and the native core (Rust):
// ops, node kinds, style properties and events. This file is the single source
// of truth. `bun run gen` writes runtime/gen/protocol.ts and
// core/crates/mantou-tree/src/protocol.rs from it; `bun run gen --check` fails
// when either is stale (design §8.1).
//
// Codes are part of the ABI: never renumber or reuse one. Append new entries,
// and bump PROTOCOL_VERSION when existing meaning changes.

export const PROTOCOL_VERSION = 2;

/** Operand types. Every op is `word0 = code | operandWords << 16`, then operands. */
export type Operand = "u32" | "f32" | "id" | "kind" | "styleId" | "string" | "styleValue" | "styleList";

export interface OpDef {
  name: string;
  code: number;
  operands: [name: string, type: Operand][];
  doc: string;
}

export const ops: OpDef[] = [
  { name: "CREATE", code: 1, operands: [["id", "id"], ["kind", "kind"]], doc: "Create a node; it starts detached." },
  { name: "INSERT", code: 2, operands: [["parent", "id"], ["child", "id"], ["before", "id"]], doc: "Insert or move child into parent before sibling `before` (0 = append). A node already in place is left alone." },
  { name: "REMOVE", code: 3, operands: [["parent", "id"], ["child", "id"]], doc: "Detach child from parent. The node stays alive until RELEASE." },
  { name: "RELEASE", code: 4, operands: [["id", "id"]], doc: "Free the node; it is detached first. Its children are detached, not freed." },
  { name: "STYLE", code: 5, operands: [["id", "id"], ["value", "styleValue"]], doc: "Set one style property on the node (overrides its shared style)." },
  { name: "STYLE_RESET", code: 6, operands: [["id", "id"], ["prop", "u32"]], doc: "Remove the node's own value for a property." },
  { name: "STYLE_DEF", code: 7, operands: [["styleId", "styleId"], ["props", "styleList"]], doc: "Define (or redefine) a shared style." },
  { name: "STYLE_USE", code: 8, operands: [["id", "id"], ["styleId", "styleId"]], doc: "Apply a shared style to the node (0 = none)." },
  { name: "LISTEN", code: 9, operands: [["id", "id"], ["mask", "u32"]], doc: "Which events the node has handlers for (EventMask bits)." },
  { name: "SET_ROOT", code: 10, operands: [["id", "id"]], doc: "Make the node the window's root (0 = none)." },
  { name: "CLEAR_COLOR", code: 11, operands: [["r", "f32"], ["g", "f32"], ["b", "f32"], ["a", "f32"]], doc: "The window's background colour (sRGB, 0–1)." },
  { name: "TITLE", code: 12, operands: [["title", "string"]], doc: "The window's title." },
];

export const nodeKinds = { View: 1 } as const;

export const eventMask = { Press: 1 } as const;

/** Style value types: how many words each takes after the property code. */
export type ValueType =
  | "f32" // 1 word
  | "color" // 1 word: RGBA8, r in the low byte
  | "length" // 2 words: unit (Unit), f32
  | { enum: readonly string[] }; // 1 word: index into the list

export const units = ["px", "percent", "auto"] as const;

const length = "length" as const;
export const styleProps: { name: string; code: number; type: ValueType; default: string }[] = [
  { name: "display", code: 1, type: { enum: ["flex", "none"] }, default: "flex" },
  { name: "flexDirection", code: 2, type: { enum: ["row", "column", "rowReverse", "columnReverse"] }, default: "column" },
  { name: "flexWrap", code: 3, type: { enum: ["noWrap", "wrap"] }, default: "noWrap" },
  { name: "justifyContent", code: 4, type: { enum: ["start", "end", "center", "spaceBetween", "spaceAround", "spaceEvenly"] }, default: "start" },
  { name: "alignItems", code: 5, type: { enum: ["stretch", "start", "end", "center", "baseline"] }, default: "stretch" },
  { name: "alignSelf", code: 6, type: { enum: ["auto", "stretch", "start", "end", "center", "baseline"] }, default: "auto" },
  { name: "flexGrow", code: 7, type: "f32", default: "0" },
  { name: "flexShrink", code: 8, type: "f32", default: "1" },
  { name: "flexBasis", code: 9, type: length, default: "auto" },
  { name: "width", code: 10, type: length, default: "auto" },
  { name: "height", code: 11, type: length, default: "auto" },
  { name: "minWidth", code: 12, type: length, default: "auto" },
  { name: "minHeight", code: 13, type: length, default: "auto" },
  { name: "maxWidth", code: 14, type: length, default: "auto" },
  { name: "maxHeight", code: 15, type: length, default: "auto" },
  { name: "paddingTop", code: 16, type: length, default: "0" },
  { name: "paddingRight", code: 17, type: length, default: "0" },
  { name: "paddingBottom", code: 18, type: length, default: "0" },
  { name: "paddingLeft", code: 19, type: length, default: "0" },
  { name: "marginTop", code: 20, type: length, default: "0" },
  { name: "marginRight", code: 21, type: length, default: "0" },
  { name: "marginBottom", code: 22, type: length, default: "0" },
  { name: "marginLeft", code: 23, type: length, default: "0" },
  { name: "rowGap", code: 24, type: length, default: "0" },
  { name: "columnGap", code: 25, type: length, default: "0" },
  { name: "position", code: 26, type: { enum: ["relative", "absolute"] }, default: "relative" },
  { name: "top", code: 27, type: length, default: "auto" },
  { name: "right", code: 28, type: length, default: "auto" },
  { name: "bottom", code: 29, type: length, default: "auto" },
  { name: "left", code: 30, type: length, default: "auto" },
  { name: "backgroundColor", code: 31, type: "color", default: "transparent" },
  { name: "opacity", code: 32, type: "f32", default: "1" },
  { name: "alignContent", code: 33, type: { enum: ["stretch", "start", "end", "center", "spaceBetween", "spaceAround", "spaceEvenly"] }, default: "stretch" },
];

/** Events: fixed 16-byte records `[type, a, b, c]` (u32 words; floats as bits). */
export const events: { name: string; code: number; fields: string; doc: string }[] = [
  { name: "WINDOW_READY", code: 1, fields: "a = width px, b = height px, c = scale (f32)", doc: "The window opened." },
  { name: "RESIZED", code: 2, fields: "a = width px, b = height px", doc: "The window's size changed." },
  { name: "POINTER_MOVE", code: 3, fields: "b = x, c = y (f32, logical px)", doc: "The pointer moved." },
  { name: "POINTER_DOWN", code: 4, fields: "a = button, b = x, c = y", doc: "A button was pressed." },
  { name: "POINTER_UP", code: 5, fields: "a = button, b = x, c = y", doc: "A button was released." },
  { name: "KEY_DOWN", code: 6, fields: "a = key, b = repeat", doc: "A key was pressed." },
  { name: "KEY_UP", code: 7, fields: "a = key", doc: "A key was released." },
  { name: "CLOSE_REQUESTED", code: 8, fields: "", doc: "The user asked to close the window." },
  { name: "SCALE_CHANGED", code: 9, fields: "c = scale (f32)", doc: "The window's scale factor changed." },
  { name: "PRESS", code: 10, fields: "a = target node, b = x, c = y (f32, logical px)", doc: "A press (down and up on the same node) on a node with a Press listener on its path." },
];
