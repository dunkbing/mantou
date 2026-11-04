// The wire protocol between the Worker (TypeScript) and the native core (Rust):
// ops, node kinds, style properties and events. This file is the single source
// of truth. `bun run gen` writes runtime/gen/protocol.ts and
// core/crates/mantou-tree/src/protocol.rs from it; `bun run gen --check` fails
// when either is stale (design §8.1).
//
// Codes are part of the ABI: never renumber or reuse one. Append new entries,
// and bump PROTOCOL_VERSION when existing meaning changes.

export const PROTOCOL_VERSION = 7;

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
  { name: "TEXT", code: 13, operands: [["id", "id"], ["text", "string"]], doc: "The content of a Text node." },
  { name: "VALUE", code: 14, operands: [["id", "id"], ["rev", "u32"], ["text", "string"]], doc: "An Input's text, from the app. Applied only when `rev` (the last TEXT_CHANGED rev the app has seen, 0 before any) is at least the input's, so a value derived from an older edit never undoes newer typing." },
  { name: "PLACEHOLDER", code: 15, operands: [["id", "id"], ["text", "string"]], doc: "What an empty Input shows." },
  { name: "INPUT_OPTIONS", code: 16, operands: [["id", "id"], ["flags", "u32"], ["maxLength", "u32"]], doc: "An Input's options: InputFlag bits, and its maximum length in characters (0 = none)." },
  { name: "FOCUS", code: 17, operands: [["id", "id"]], doc: "Focus an Input (0 = blur the focused one). FOCUS and BLUR events follow." },
  { name: "SCROLL_TO", code: 19, operands: [["id", "id"], ["x", "f32"], ["y", "f32"], ["flags", "u32"]], doc: "Scroll a scroll view to an offset (NaN keeps that axis), or by it with ScrollFlag.By. Clamped, and applied after the batch's layout." },
  { name: "SCROLL_INTO_VIEW", code: 20, operands: [["id", "id"], ["block", "u32"]], doc: "Scroll the node's scroll-view ancestors so it shows (ScrollBlock), after the batch's layout." },
  { name: "FOCUS_SCOPE", code: 18, operands: [["id", "id"], ["flags", "u32"]], doc: "Make a view a focus scope (FocusScopeFlag bits; 0 = not one): Tab stays inside the topmost scope on screen, and the focus goes back where it was when the scope leaves the screen." },
];

export const nodeKinds = { View: 1, Text: 2, Input: 3 } as const;

/** FOCUS_SCOPE flags. */
export const focusScopeFlags = { Trap: 1, Restore: 2 } as const;

/** INPUT_OPTIONS flags. Secure: a bullet per character, no copying, the IME off. */
export const inputFlags = { Multiline: 1, Secure: 2, ReadOnly: 4 } as const;

/** LISTEN bits: which events a node has handlers for. */
export const eventMask = { Press: 1, Layout: 2, Scroll: 4 } as const;

/** SCROLL_TO flags. */
export const scrollFlags = { By: 1 } as const;

/** SCROLL_INTO_VIEW: where the node ends up in its scroll view ("nearest" moves as little as it can). */
export const scrollBlocks = { Nearest: 0, Start: 1, Center: 2, End: 3 } as const;

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
  // Text (Text nodes; not inherited yet).
  { name: "color", code: 34, type: "color", default: "#000000ff" },
  { name: "fontSize", code: 35, type: "f32", default: "14" },
  { name: "fontWeight", code: 36, type: "f32", default: "400" },
  { name: "lineHeight", code: 37, type: "f32", default: "0 (the font's own)" },
  { name: "textAlign", code: 38, type: { enum: ["start", "center", "end"] }, default: "start" },
  { name: "maxLines", code: 39, type: "f32", default: "0 (no limit); a cut-off last line ends in an ellipsis" },
  { name: "fontStyle", code: 40, type: { enum: ["normal", "italic"] }, default: "normal" },
  // "hidden" clips the node's children to its box; "scroll" clips them and the core scrolls them.
  { name: "overflow", code: 41, type: { enum: ["visible", "hidden", "scroll"] }, default: "visible" },
  // Box decoration. The border is drawn inside the box and insets its content, as CSS's border-box.
  { name: "borderRadius", code: 42, type: "f32", default: "0" },
  { name: "borderWidth", code: 43, type: "f32", default: "0" },
  { name: "borderColor", code: 44, type: "color", default: "transparent" },
  // Inputs.
  { name: "placeholderColor", code: 45, type: "color", default: "the text colour at 40% opacity" },
  { name: "caretColor", code: 46, type: "color", default: "the text colour" },
  { name: "selectionColor", code: 47, type: "color", default: "#3b82f666" },
  // Scroll views (overflow: "scroll"): a thumb drawn over the content while it overflows, which can be dragged.
  { name: "scrollbar", code: 48, type: { enum: ["auto", "none"] }, default: "auto" },
  { name: "scrollbarColor", code: 49, type: "color", default: "#8080808c" },
];

/**
 * Events: records of u32 words (floats as bits), `[head, a, b, c]` and then
 * `head >> 16` more words: `head & 0xffff` is the type. Most events have no
 * extra words; TEXT_CHANGED carries its text.
 */
export const events: { name: string; code: number; fields: string; doc: string }[] = [
  { name: "WINDOW_READY", code: 1, fields: "a = width px, b = height px, c = scale (f32)", doc: "The window opened." },
  { name: "RESIZED", code: 2, fields: "a = width px, b = height px, c = scale (f32)", doc: "The window's size changed." },
  { name: "POINTER_MOVE", code: 3, fields: "b = x, c = y (f32, logical px)", doc: "The pointer moved." },
  { name: "POINTER_DOWN", code: 4, fields: "a = button, b = x, c = y", doc: "A button was pressed." },
  { name: "POINTER_UP", code: 5, fields: "a = button, b = x, c = y", doc: "A button was released." },
  { name: "KEY_DOWN", code: 6, fields: "a = key, b = repeat, c = modifiers (KeyModifier bits)", doc: "A key was pressed." },
  { name: "KEY_UP", code: 7, fields: "a = key, c = modifiers", doc: "A key was released." },
  { name: "CLOSE_REQUESTED", code: 8, fields: "", doc: "The user asked to close the window." },
  { name: "SCALE_CHANGED", code: 9, fields: "c = scale (f32)", doc: "The window's scale factor changed." },
  { name: "PRESS", code: 10, fields: "a = target node, b = x, c = y (f32, logical px)", doc: "A press (down and up on the same node) on a node with a Press listener on its path." },
  { name: "WHEEL", code: 11, fields: "a = node under the pointer (0 = none), b = dx, c = dy (f32, logical px; positive dy scrolls content up)", doc: "The wheel or trackpad scrolled." },
  { name: "FOCUS", code: 12, fields: "a = input", doc: "An Input got the keyboard focus." },
  { name: "BLUR", code: 13, fields: "a = input", doc: "An Input lost the keyboard focus." },
  { name: "TEXT_CHANGED", code: 14, fields: "a = input, b = rev (counts the user's edits), c = byte length; then the UTF-8 text, padded to words", doc: "The user changed an Input's text." },
  { name: "SUBMIT", code: 15, fields: "a = input", doc: "Enter in a single-line Input." },
  { name: "SCROLL", code: 17, fields: "a = scroll view, b = x, c = y (f32, logical px: the offset)", doc: "A scroll view with a Scroll listener scrolled (at most once per frame)." },
  { name: "LAYOUT", code: 16, fields: "a = node, b = x, c = y; then width, height (f32, logical px, from the window's top left)", doc: "A node with a Layout listener was laid out at a new box (or for the first time since it listened)." },
  { name: "SERVICE_RESULT", code: 18, fields: "a = request id, b = 0 answered or 1 cancelled, c = byte length; then the UTF-8 JSON answer, padded to words", doc: "A platform service (dialog, context menu) finished." },
  { name: "MENU", code: 19, fields: "c = byte length; then the UTF-8 id of the menu item, padded to words", doc: "The user chose an item of the app menu." },
];

/** Bits of a key event's modifiers. */
export const keyModifiers = { Shift: 1, Control: 2, Alt: 4, Meta: 8 } as const;

/** Keys travel as Unicode scalars, or these codes above the Unicode range. */
export const namedKeys = {
  Escape: 0x110000, Enter: 0x110001, ArrowUp: 0x110002, ArrowDown: 0x110003, ArrowLeft: 0x110004, ArrowRight: 0x110005,
  Backspace: 0x110006, Delete: 0x110007, Tab: 0x110008, Home: 0x110009, End: 0x11000a, PageUp: 0x11000b, PageDown: 0x11000c,
  Unidentified: 0x11ffff,
} as const;
