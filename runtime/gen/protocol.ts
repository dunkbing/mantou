// Written by schema/gen.ts from schema/protocol.ts. Don't edit it; change the schema and run `bun run gen`.

export const PROTOCOL_VERSION = 7;

export const Op = {
  /** Create a node; it starts detached. */
  CREATE: 1,
  /** Insert or move child into parent before sibling `before` (0 = append). A node already in place is left alone. */
  INSERT: 2,
  /** Detach child from parent. The node stays alive until RELEASE. */
  REMOVE: 3,
  /** Free the node; it is detached first. Its children are detached, not freed. */
  RELEASE: 4,
  /** Set one style property on the node (overrides its shared style). */
  STYLE: 5,
  /** Remove the node's own value for a property. */
  STYLE_RESET: 6,
  /** Define (or redefine) a shared style. */
  STYLE_DEF: 7,
  /** Apply a shared style to the node (0 = none). */
  STYLE_USE: 8,
  /** Which events the node has handlers for (EventMask bits). */
  LISTEN: 9,
  /** Make the node the window's root (0 = none). */
  SET_ROOT: 10,
  /** The window's background colour (sRGB, 0–1). */
  CLEAR_COLOR: 11,
  /** The window's title. */
  TITLE: 12,
  /** The content of a Text node. */
  TEXT: 13,
  /** An Input's text, from the app. Applied only when `rev` (the last TEXT_CHANGED rev the app has seen, 0 before any) is at least the input's, so a value derived from an older edit never undoes newer typing. */
  VALUE: 14,
  /** What an empty Input shows. */
  PLACEHOLDER: 15,
  /** An Input's options: InputFlag bits, and its maximum length in characters (0 = none). */
  INPUT_OPTIONS: 16,
  /** Focus an Input (0 = blur the focused one). FOCUS and BLUR events follow. */
  FOCUS: 17,
  /** Scroll a scroll view to an offset (NaN keeps that axis), or by it with ScrollFlag.By. Clamped, and applied after the batch's layout. */
  SCROLL_TO: 19,
  /** Scroll the node's scroll-view ancestors so it shows (ScrollBlock), after the batch's layout. */
  SCROLL_INTO_VIEW: 20,
  /** Make a view a focus scope (FocusScopeFlag bits; 0 = not one): Tab stays inside the topmost scope on screen, and the focus goes back where it was when the scope leaves the screen. */
  FOCUS_SCOPE: 18,
} as const;

export const OpName: Record<number, string> = { 1: "CREATE", 2: "INSERT", 3: "REMOVE", 4: "RELEASE", 5: "STYLE", 6: "STYLE_RESET", 7: "STYLE_DEF", 8: "STYLE_USE", 9: "LISTEN", 10: "SET_ROOT", 11: "CLEAR_COLOR", 12: "TITLE", 13: "TEXT", 14: "VALUE", 15: "PLACEHOLDER", 16: "INPUT_OPTIONS", 17: "FOCUS", 19: "SCROLL_TO", 20: "SCROLL_INTO_VIEW", 18: "FOCUS_SCOPE" };

export const NodeKind = {"View":1,"Text":2,"Input":3} as const;
export const EventMask = {"Press":1,"Layout":2,"Scroll":4} as const;
export const InputFlag = {"Multiline":1,"Secure":2,"ReadOnly":4} as const;
export const FocusScopeFlag = {"Trap":1,"Restore":2} as const;
export const ScrollFlag = {"By":1} as const;
export const ScrollBlock = {"Nearest":0,"Start":1,"Center":2,"End":3} as const;
export const Unit = { px: 0, percent: 1, auto: 2 } as const;
export const KeyModifier = {"Shift":1,"Control":2,"Alt":4,"Meta":8} as const;
export const NamedKey = {"Escape":1114112,"Enter":1114113,"ArrowUp":1114114,"ArrowDown":1114115,"ArrowLeft":1114116,"ArrowRight":1114117,"Backspace":1114118,"Delete":1114119,"Tab":1114120,"Home":1114121,"End":1114122,"PageUp":1114123,"PageDown":1114124,"Unidentified":1179647} as const;

export const Event = {
  /** The window opened. a = width px, b = height px, c = scale (f32). */
  WINDOW_READY: 1,
  /** The window's size changed. a = width px, b = height px, c = scale (f32). */
  RESIZED: 2,
  /** The pointer moved. b = x, c = y (f32, logical px). */
  POINTER_MOVE: 3,
  /** A button was pressed. a = button, b = x, c = y. */
  POINTER_DOWN: 4,
  /** A button was released. a = button, b = x, c = y. */
  POINTER_UP: 5,
  /** A key was pressed. a = key, b = repeat, c = modifiers (KeyModifier bits). */
  KEY_DOWN: 6,
  /** A key was released. a = key, c = modifiers. */
  KEY_UP: 7,
  /** The user asked to close the window. */
  CLOSE_REQUESTED: 8,
  /** The window's scale factor changed. c = scale (f32). */
  SCALE_CHANGED: 9,
  /** A press (down and up on the same node) on a node with a Press listener on its path. a = target node, b = x, c = y (f32, logical px). */
  PRESS: 10,
  /** The wheel or trackpad scrolled. a = node under the pointer (0 = none), b = dx, c = dy (f32, logical px; positive dy scrolls content up). */
  WHEEL: 11,
  /** An Input got the keyboard focus. a = input. */
  FOCUS: 12,
  /** An Input lost the keyboard focus. a = input. */
  BLUR: 13,
  /** The user changed an Input's text. a = input, b = rev (counts the user's edits), c = byte length; then the UTF-8 text, padded to words. */
  TEXT_CHANGED: 14,
  /** Enter in a single-line Input. a = input. */
  SUBMIT: 15,
  /** A scroll view with a Scroll listener scrolled (at most once per frame). a = scroll view, b = x, c = y (f32, logical px: the offset). */
  SCROLL: 17,
  /** A node with a Layout listener was laid out at a new box (or for the first time since it listened). a = node, b = x, c = y; then width, height (f32, logical px, from the window's top left). */
  LAYOUT: 16,
  /** A platform service (dialog, context menu) finished. a = request id, b = 0 answered or 1 cancelled, c = byte length; then the UTF-8 JSON answer, padded to words. */
  SERVICE_RESULT: 18,
  /** The user chose an item of the app menu. c = byte length; then the UTF-8 id of the menu item, padded to words. */
  MENU: 19,
} as const;

export type ValueKind = "f32" | "color" | "length" | "enum";
export const StyleProp = {
  display: { code: 1, kind: "enum", values: ["flex","none"] },
  flexDirection: { code: 2, kind: "enum", values: ["row","column","rowReverse","columnReverse"] },
  flexWrap: { code: 3, kind: "enum", values: ["noWrap","wrap"] },
  justifyContent: { code: 4, kind: "enum", values: ["start","end","center","spaceBetween","spaceAround","spaceEvenly"] },
  alignItems: { code: 5, kind: "enum", values: ["stretch","start","end","center","baseline"] },
  alignSelf: { code: 6, kind: "enum", values: ["auto","stretch","start","end","center","baseline"] },
  flexGrow: { code: 7, kind: "f32" },
  flexShrink: { code: 8, kind: "f32" },
  flexBasis: { code: 9, kind: "length" },
  width: { code: 10, kind: "length" },
  height: { code: 11, kind: "length" },
  minWidth: { code: 12, kind: "length" },
  minHeight: { code: 13, kind: "length" },
  maxWidth: { code: 14, kind: "length" },
  maxHeight: { code: 15, kind: "length" },
  paddingTop: { code: 16, kind: "length" },
  paddingRight: { code: 17, kind: "length" },
  paddingBottom: { code: 18, kind: "length" },
  paddingLeft: { code: 19, kind: "length" },
  marginTop: { code: 20, kind: "length" },
  marginRight: { code: 21, kind: "length" },
  marginBottom: { code: 22, kind: "length" },
  marginLeft: { code: 23, kind: "length" },
  rowGap: { code: 24, kind: "length" },
  columnGap: { code: 25, kind: "length" },
  position: { code: 26, kind: "enum", values: ["relative","absolute"] },
  top: { code: 27, kind: "length" },
  right: { code: 28, kind: "length" },
  bottom: { code: 29, kind: "length" },
  left: { code: 30, kind: "length" },
  backgroundColor: { code: 31, kind: "color" },
  opacity: { code: 32, kind: "f32" },
  alignContent: { code: 33, kind: "enum", values: ["stretch","start","end","center","spaceBetween","spaceAround","spaceEvenly"] },
  color: { code: 34, kind: "color" },
  fontSize: { code: 35, kind: "f32" },
  fontWeight: { code: 36, kind: "f32" },
  lineHeight: { code: 37, kind: "f32" },
  textAlign: { code: 38, kind: "enum", values: ["start","center","end"] },
  maxLines: { code: 39, kind: "f32" },
  fontStyle: { code: 40, kind: "enum", values: ["normal","italic"] },
  overflow: { code: 41, kind: "enum", values: ["visible","hidden","scroll"] },
  borderRadius: { code: 42, kind: "f32" },
  borderWidth: { code: 43, kind: "f32" },
  borderColor: { code: 44, kind: "color" },
  placeholderColor: { code: 45, kind: "color" },
  caretColor: { code: 46, kind: "color" },
  selectionColor: { code: 47, kind: "color" },
  scrollbar: { code: 48, kind: "enum", values: ["auto","none"] },
  scrollbarColor: { code: 49, kind: "color" },
} as const;
export type StylePropName = keyof typeof StyleProp;
export const StylePropByCode: Record<number, StylePropName> = { 1: "display", 2: "flexDirection", 3: "flexWrap", 4: "justifyContent", 5: "alignItems", 6: "alignSelf", 7: "flexGrow", 8: "flexShrink", 9: "flexBasis", 10: "width", 11: "height", 12: "minWidth", 13: "minHeight", 14: "maxWidth", 15: "maxHeight", 16: "paddingTop", 17: "paddingRight", 18: "paddingBottom", 19: "paddingLeft", 20: "marginTop", 21: "marginRight", 22: "marginBottom", 23: "marginLeft", 24: "rowGap", 25: "columnGap", 26: "position", 27: "top", 28: "right", 29: "bottom", 30: "left", 31: "backgroundColor", 32: "opacity", 33: "alignContent", 34: "color", 35: "fontSize", 36: "fontWeight", 37: "lineHeight", 38: "textAlign", 39: "maxLines", 40: "fontStyle", 41: "overflow", 42: "borderRadius", 43: "borderWidth", 44: "borderColor", 45: "placeholderColor", 46: "caretColor", 47: "selectionColor", 48: "scrollbar", 49: "scrollbarColor" };

/** A length: logical pixels, a percentage string, or "auto". */
export type Length = number | `${number}%` | "auto";
/** A colour: "#rgb", "#rrggbb", "#rrggbbaa", "transparent", or [r, g, b, a?] with r, g, b in 0–255 and a in 0–1. */
export type Color = string | readonly [number, number, number] | readonly [number, number, number, number];

/** Style properties as the core understands them (one wire property each). */
export interface WireStyle {
  /** Default: flex. */
  display?: "flex" | "none";
  /** Default: column. */
  flexDirection?: "row" | "column" | "rowReverse" | "columnReverse";
  /** Default: noWrap. */
  flexWrap?: "noWrap" | "wrap";
  /** Default: start. */
  justifyContent?: "start" | "end" | "center" | "spaceBetween" | "spaceAround" | "spaceEvenly";
  /** Default: stretch. */
  alignItems?: "stretch" | "start" | "end" | "center" | "baseline";
  /** Default: auto. */
  alignSelf?: "auto" | "stretch" | "start" | "end" | "center" | "baseline";
  /** Default: 0. */
  flexGrow?: number;
  /** Default: 1. */
  flexShrink?: number;
  /** Default: auto. */
  flexBasis?: Length;
  /** Default: auto. */
  width?: Length;
  /** Default: auto. */
  height?: Length;
  /** Default: auto. */
  minWidth?: Length;
  /** Default: auto. */
  minHeight?: Length;
  /** Default: auto. */
  maxWidth?: Length;
  /** Default: auto. */
  maxHeight?: Length;
  /** Default: 0. */
  paddingTop?: Length;
  /** Default: 0. */
  paddingRight?: Length;
  /** Default: 0. */
  paddingBottom?: Length;
  /** Default: 0. */
  paddingLeft?: Length;
  /** Default: 0. */
  marginTop?: Length;
  /** Default: 0. */
  marginRight?: Length;
  /** Default: 0. */
  marginBottom?: Length;
  /** Default: 0. */
  marginLeft?: Length;
  /** Default: 0. */
  rowGap?: Length;
  /** Default: 0. */
  columnGap?: Length;
  /** Default: relative. */
  position?: "relative" | "absolute";
  /** Default: auto. */
  top?: Length;
  /** Default: auto. */
  right?: Length;
  /** Default: auto. */
  bottom?: Length;
  /** Default: auto. */
  left?: Length;
  /** Default: transparent. */
  backgroundColor?: Color;
  /** Default: 1. */
  opacity?: number;
  /** Default: stretch. */
  alignContent?: "stretch" | "start" | "end" | "center" | "spaceBetween" | "spaceAround" | "spaceEvenly";
  /** Default: #000000ff. */
  color?: Color;
  /** Default: 14. */
  fontSize?: number;
  /** Default: 400. */
  fontWeight?: number;
  /** Default: 0 (the font's own). */
  lineHeight?: number;
  /** Default: start. */
  textAlign?: "start" | "center" | "end";
  /** Default: 0 (no limit); a cut-off last line ends in an ellipsis. */
  maxLines?: number;
  /** Default: normal. */
  fontStyle?: "normal" | "italic";
  /** Default: visible. */
  overflow?: "visible" | "hidden" | "scroll";
  /** Default: 0. */
  borderRadius?: number;
  /** Default: 0. */
  borderWidth?: number;
  /** Default: transparent. */
  borderColor?: Color;
  /** Default: the text colour at 40% opacity. */
  placeholderColor?: Color;
  /** Default: the text colour. */
  caretColor?: Color;
  /** Default: #3b82f666. */
  selectionColor?: Color;
  /** Default: auto. */
  scrollbar?: "auto" | "none";
  /** Default: #8080808c. */
  scrollbarColor?: Color;
}
