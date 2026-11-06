// Written by schema/gen.ts from schema/protocol.ts. Don't edit it; change the schema and run `bun run gen`.

export const PROTOCOL_VERSION = 14;

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
  /** Focus an Input or a focusable view (0 = blur the focused one). FOCUS and BLUR events follow. */
  FOCUS: 17,
  /** Lets a view take the keyboard focus (FocusableFlag bits; 0 = it can't): a press or Tab focuses it, Enter and Space press it, and a focused scroll view scrolls with the keys. Tab visits nodes with an order (1 first) before the rest, which go in tree order. */
  FOCUSABLE: 34,
  /** Scroll a scroll view to an offset (NaN keeps that axis), or by it with ScrollFlag.By. Clamped, and applied after the batch's layout. */
  SCROLL_TO: 19,
  /** Scroll the node's scroll-view ancestors so it shows (ScrollBlock), after the batch's layout. */
  SCROLL_INTO_VIEW: 20,
  /** Register a font file (TTF, OTF or a collection) with the instance; text uses it by its family name. */
  FONT: 21,
  /** Define a font family id (1 and up) for fontFamily styles: a comma-separated list of family names, tried in order before Mantou's own fonts. */
  FONT_FAMILY: 22,
  /** Resize the window's content area (logical px). A headless instance resizes its viewport. */
  WINDOW_SIZE: 23,
  /** The window's smallest and largest content size (logical px, 0 = no limit), and WindowFlag bits. */
  WINDOW_LIMITS: 24,
  /** An Image's source: a PNG, JPEG, WebP or SVG file the core reads and decodes. IMAGE_LOAD or IMAGE_ERROR follows. */
  IMAGE_PATH: 25,
  /** An Image's source as the file's bytes. */
  IMAGE_DATA: 26,
  /** When the node's `prop` changes, animate to the new value over `duration` ms (Easing; 0 = no transition). Animatable: opacity, translateX, translateY, scale, backgroundColor, borderColor, color. */
  TRANSITION: 27,
  /** Animate the node's `prop` from `from` to `to` (an f32's bits, or a colour), `iterations` times (Infinity = forever; AnimateFlag.Alternate goes back and forth), then back to its style. ANIMATION_END(animation) follows. */
  ANIMATE: 28,
  /** Select an Input's text from `anchor` to `focus` (the caret), in UTF-16 code units like the DOM's selectionStart (clamped; equal = a caret). */
  SELECT: 29,
  /** Make a view a focus scope (FocusScopeFlag bits; 0 = not one): Tab stays inside the topmost scope on screen, and the focus goes back where it was when the scope leaves the screen. */
  FOCUS_SCOPE: 18,
  /** What a view draws over its background: a list of drawing commands as words (CanvasCmd, then its operands: numbers as f32 bits in the view's logical px from its content box's top left, colours as RGBA8), replacing the last list. Empty = nothing. */
  CANVAS: 35,
  /** Steps for the running ANIMATE `animation` on the node: two or more values (f32 bits, or colours as RGBA8) spaced evenly over one iteration; its easing applies to each step. They replace the animation's from and to. */
  KEYFRAMES: 32,
  /** The characters an Input accepts from typing and pasting: a set like `0-9.` (single characters and `a-z` ranges; a leading `^` allows everything but the set). Empty = anything. Text set by the app isn't filtered. */
  INPUT_ALLOW: 31,
  /** Splits a Text's text into runs set in spans (nested Texts): for each run, in order, its UTF-8 byte length, how many spans it's in, and their ids, outermost first. The lengths add up to the text's. No runs: all of it in the Text's own style. A span is a Text node that is never inserted; its own style's text properties apply to its runs, and presses and the cursor over them go to it. */
  TEXT_RUNS: 33,
  /** What assistive technology (screen readers) is told about the node: its AccessRole (0 = the default for its kind), AccessFlag bits, and its name (empty = taken from the text inside it). */
  ACCESS: 30,
  /** The node is drawn with its top left at the pointer minus (x, y) logical px, against the window like a fixed node, and moves with the pointer on the main thread, with no JS (a drag's preview; give it pointerEvents none). One node at a time; id 0 = none. */
  FOLLOW_POINTER: 36,
  /** An Html node's document: static HTML and CSS, parsed and laid out by the core (no scripts run, nothing is fetched); HtmlFlag bits. The node's height follows the document's at its width. What it asks for (images, stylesheets) comes back as HTML_REQUEST events. */
  HTML: 37,
  /** The app's answer to an HTML_REQUEST: `data` is the URL's UTF-8 bytes (`urlLength` of them), then the resource's bytes when `found` is 1 (0: blocked or missing; an image shows nothing). */
  HTML_RESOURCE: 38,
  /** How the instance animates: MotionFlag.Reduced is reduced motion (movement — translate, scale, rotate and layout transitions and animations — jumps to its end, and running movement ends; opacity and colours still fade), and `speed` scales the animation clock (1 = real time; 0.25 plays animations four times slower, to look at them). */
  MOTION: 39,
  /** Style changes between INSTANT 1 and INSTANT 0 apply at once, with no transitions (running ones of those properties end there), and the next layout moves nothing with a layout transition. */
  INSTANT: 40,
} as const;

export const OpName: Record<number, string> = { 1: "CREATE", 2: "INSERT", 3: "REMOVE", 4: "RELEASE", 5: "STYLE", 6: "STYLE_RESET", 7: "STYLE_DEF", 8: "STYLE_USE", 9: "LISTEN", 10: "SET_ROOT", 11: "CLEAR_COLOR", 12: "TITLE", 13: "TEXT", 14: "VALUE", 15: "PLACEHOLDER", 16: "INPUT_OPTIONS", 17: "FOCUS", 34: "FOCUSABLE", 19: "SCROLL_TO", 20: "SCROLL_INTO_VIEW", 21: "FONT", 22: "FONT_FAMILY", 23: "WINDOW_SIZE", 24: "WINDOW_LIMITS", 25: "IMAGE_PATH", 26: "IMAGE_DATA", 27: "TRANSITION", 28: "ANIMATE", 29: "SELECT", 18: "FOCUS_SCOPE", 35: "CANVAS", 32: "KEYFRAMES", 31: "INPUT_ALLOW", 33: "TEXT_RUNS", 30: "ACCESS", 36: "FOLLOW_POINTER", 37: "HTML", 38: "HTML_RESOURCE", 39: "MOTION", 40: "INSTANT" };

export const NodeKind = {"View":1,"Text":2,"Input":3,"Image":4,"Html":5} as const;
export const EventMask = {"Press":1,"Layout":2,"Scroll":4,"Hover":8,"Pointer":16,"Drop":32,"Select":64} as const;
export const InputFlag = {"Multiline":1,"Secure":2,"ReadOnly":4} as const;
export const FocusScopeFlag = {"Trap":1,"Restore":2} as const;
export const FocusableFlag = {"Focusable":1,"SkipTab":2} as const;
export const AccessRole = {"Auto":0,"None":1,"Button":2,"Checkbox":3,"Switch":4,"Radio":5,"Link":6,"Heading":7,"List":8,"ListItem":9,"Dialog":10,"Tab":11,"TabList":12,"Menu":13,"MenuItem":14,"Image":15,"Group":16,"Status":17,"Alert":18} as const;
export const AccessFlag = {"Checked":1,"Mixed":2,"Selected":4,"Disabled":8,"Hidden":16} as const;
export const WindowFlag = {"NotResizable":1,"Frameless":2,"AlwaysOnTop":4,"Fullscreen":8,"Maximized":16,"HasPosition":32,"TitleOverlay":64} as const;
export const WindowStateFlag = {"Focused":1,"Minimized":2,"Maximized":4,"Fullscreen":8,"Dark":16} as const;
export const HtmlFlag = {"Dark":1} as const;
export const CanvasCmd = {"FillRect":1,"StrokeRect":2,"Line":3,"Circle":4,"StrokeCircle":5,"RoundRect":6,"Area":7,"FillPoly":8,"Text":9} as const;
export const Easing = {"Linear":0,"Ease":1,"EaseIn":2,"EaseOut":3,"EaseInOut":4,"Spring":16} as const;
export const AnimateFlag = {"Alternate":1} as const;
export const MotionFlag = {"Reduced":1} as const;
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
  /** An Input or a focusable view got the keyboard focus. a = input or view. */
  FOCUS: 12,
  /** An Input or a focusable view lost the keyboard focus. a = input or view. */
  BLUR: 13,
  /** The user changed an Input's text. a = input, b = rev (counts the user's edits), c = byte length; then the UTF-8 text, padded to words. */
  TEXT_CHANGED: 14,
  /** Enter in a single-line Input. a = input. */
  SUBMIT: 15,
  /** A scroll view with a Scroll listener scrolled (at most once per frame). a = scroll view, b = x, c = y (f32, logical px: the offset). */
  SCROLL: 17,
  /** An Image's source was decoded. a = image node, b = natural width, c = natural height (f32, logical px). */
  IMAGE_LOAD: 20,
  /** An Image's source couldn't be read or decoded. a = image node, c = byte length; then the UTF-8 message, padded to words. */
  IMAGE_ERROR: 21,
  /** The pointer came over a node with a Hover listener (or one of its descendants). Ancestors first. a = node. */
  POINTER_ENTER: 23,
  /** The pointer left a node with a Hover listener: it moved off, left the window, or the node moved, hid or was removed under it. Descendants first. a = node. */
  POINTER_LEAVE: 24,
  /** An ANIMATE finished (or was replaced or its node released). a = node, b = animation id. */
  ANIMATION_END: 22,
  /** A node with a Layout listener was laid out at a new box (or for the first time since it listened). a = node, b = x, c = y; then width, height (f32, logical px, from the window's top left). */
  LAYOUT: 16,
  /** A platform service (dialog, context menu) finished. a = request id, b = 0 answered or 1 cancelled, c = byte length; then the UTF-8 JSON answer, padded to words. */
  SERVICE_RESULT: 18,
  /** The user chose an item of the app menu. c = byte length; then the UTF-8 id of the menu item, padded to words. */
  MENU: 19,
  /** The pointer went down, up or moved, for a node whose path to the root has a Pointer listener. While a button is held, everything goes to the node that was pressed (even outside it); moves are coalesced into one per batch. a = target node, b = x, c = y (f32, logical px); then kind (0 down, 1 up, 2 move), button, buttons held (a bit per button), modifiers (KeyModifier bits), clicks (1, 2… for presses in a row at one spot). */
  NODE_POINTER: 25,
  /** The window's state changed: it gained or lost the focus, moved, was minimized, maximized or made full screen. a = WindowStateFlag bits (focused, minimized, maximized, fullscreen, dark system theme), b = x, c = y (i32 as u32: the window's outer position, logical px). */
  WINDOW_STATE: 27,
  /** The core recovered from a panic (an operation was dropped; the app runs on). Sent to the instance the call was for, else the first window's. c = byte length; then UTF-8 JSON { message, report } (report: the file the core wrote, or ""), padded to words. */
  CORE_ERROR: 29,
  /** An Input's caret or selection moved. a = input, b = anchor, c = focus (UTF-16 units, equal = a caret); only for Inputs with a Select listener, when their selection changes. */
  SELECTION: 28,
  /** A native web view (the `webview` service) loaded a page or sent a message with `window.ipc.postMessage`. a = web view id, b = kind (0 the page loaded, 1 a message from the page), c = byte length; then the UTF-8 JSON ({url, title} or the page's message text), padded to words. */
  WEBVIEW: 30,
  /** An Html node's document asks for an image or a stylesheet (once per URL); the app answers with HTML_RESOURCE. a = Html node, c = byte length; then the UTF-8 URL, padded to words. */
  HTML_REQUEST: 31,
  /** Files are dragged over the window or dropped on it. The target is the topmost node under the pointer's last position with a Drop listener on its path. a = kind (0 files held over the window, 1 they left, 2 dropped), b = target node (0 none), c = byte length; then the UTF-8 JSON {x, y, files}, padded to words. */
  FILE_DROP: 26,
} as const;

export type ValueKind = "f32" | "color" | "length" | "family" | "enum";
export const StyleProp = {
  display: { code: 1, kind: "enum", values: ["flex","none","grid"] },
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
  position: { code: 26, kind: "enum", values: ["relative","absolute","fixed","sticky"] },
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
  fontFamily: { code: 50, kind: "family" },
  shadowX: { code: 51, kind: "f32" },
  shadowY: { code: 52, kind: "f32" },
  shadowBlur: { code: 53, kind: "f32" },
  shadowSpread: { code: 54, kind: "f32" },
  shadowColor: { code: 55, kind: "color" },
  objectFit: { code: 56, kind: "enum", values: ["fill","contain","cover"] },
  translateX: { code: 57, kind: "f32" },
  translateY: { code: 58, kind: "f32" },
  scale: { code: 59, kind: "f32" },
  cursor: { code: 60, kind: "enum", values: ["auto","default","pointer","text","grab","grabbing","notAllowed","move","crosshair","wait","progress","help","ewResize","nsResize","neswResize","nwseResize","colResize","rowResize","none"] },
  textDecoration: { code: 61, kind: "enum", values: ["none","underline","lineThrough"] },
  letterSpacing: { code: 62, kind: "f32" },
  textTransform: { code: 63, kind: "enum", values: ["none","uppercase","lowercase","capitalize"] },
  whiteSpace: { code: 64, kind: "enum", values: ["normal","nowrap","pre"] },
  textOverflow: { code: 65, kind: "enum", values: ["ellipsis","clip"] },
  wordBreak: { code: 66, kind: "enum", values: ["normal","breakAll","keepAll","breakWord"] },
  userSelect: { code: 67, kind: "enum", values: ["none","text"] },
  gridColumns: { code: 68, kind: "f32" },
  gridMinColumnWidth: { code: 69, kind: "length" },
  gridColumnSpan: { code: 70, kind: "f32" },
  gridRowSpan: { code: 71, kind: "f32" },
  aspectRatio: { code: 72, kind: "f32" },
  pointerEvents: { code: 73, kind: "enum", values: ["auto","none"] },
  gradientColor: { code: 74, kind: "color" },
  gradientAngle: { code: 75, kind: "f32" },
  borderTopLeftRadius: { code: 76, kind: "f32" },
  borderTopRightRadius: { code: 77, kind: "f32" },
  borderBottomRightRadius: { code: 78, kind: "f32" },
  borderBottomLeftRadius: { code: 79, kind: "f32" },
  borderTopWidth: { code: 80, kind: "f32" },
  borderRightWidth: { code: 81, kind: "f32" },
  borderBottomWidth: { code: 82, kind: "f32" },
  borderLeftWidth: { code: 83, kind: "f32" },
  focusRingColor: { code: 85, kind: "color" },
  focusRingOffset: { code: 86, kind: "f32" },
  rotate: { code: 87, kind: "f32" },
  gradientMidColor: { code: 88, kind: "color" },
  gradientMidAt: { code: 89, kind: "f32" },
  gradientShape: { code: 90, kind: "enum", values: ["linear","radial"] },
  brightness: { code: 91, kind: "f32" },
  saturate: { code: 92, kind: "f32" },
  contrast: { code: 93, kind: "f32" },
  invert: { code: 94, kind: "f32" },
  borderTopColor: { code: 95, kind: "color" },
  borderRightColor: { code: 96, kind: "color" },
  borderBottomColor: { code: 97, kind: "color" },
  borderLeftColor: { code: 98, kind: "color" },
  layout: { code: 99, kind: "f32" },
  zIndex: { code: 84, kind: "f32" },
} as const;
export type StylePropName = keyof typeof StyleProp;
export const StylePropByCode: Record<number, StylePropName> = { 1: "display", 2: "flexDirection", 3: "flexWrap", 4: "justifyContent", 5: "alignItems", 6: "alignSelf", 7: "flexGrow", 8: "flexShrink", 9: "flexBasis", 10: "width", 11: "height", 12: "minWidth", 13: "minHeight", 14: "maxWidth", 15: "maxHeight", 16: "paddingTop", 17: "paddingRight", 18: "paddingBottom", 19: "paddingLeft", 20: "marginTop", 21: "marginRight", 22: "marginBottom", 23: "marginLeft", 24: "rowGap", 25: "columnGap", 26: "position", 27: "top", 28: "right", 29: "bottom", 30: "left", 31: "backgroundColor", 32: "opacity", 33: "alignContent", 34: "color", 35: "fontSize", 36: "fontWeight", 37: "lineHeight", 38: "textAlign", 39: "maxLines", 40: "fontStyle", 41: "overflow", 42: "borderRadius", 43: "borderWidth", 44: "borderColor", 45: "placeholderColor", 46: "caretColor", 47: "selectionColor", 48: "scrollbar", 49: "scrollbarColor", 50: "fontFamily", 51: "shadowX", 52: "shadowY", 53: "shadowBlur", 54: "shadowSpread", 55: "shadowColor", 56: "objectFit", 57: "translateX", 58: "translateY", 59: "scale", 60: "cursor", 61: "textDecoration", 62: "letterSpacing", 63: "textTransform", 64: "whiteSpace", 65: "textOverflow", 66: "wordBreak", 67: "userSelect", 68: "gridColumns", 69: "gridMinColumnWidth", 70: "gridColumnSpan", 71: "gridRowSpan", 72: "aspectRatio", 73: "pointerEvents", 74: "gradientColor", 75: "gradientAngle", 76: "borderTopLeftRadius", 77: "borderTopRightRadius", 78: "borderBottomRightRadius", 79: "borderBottomLeftRadius", 80: "borderTopWidth", 81: "borderRightWidth", 82: "borderBottomWidth", 83: "borderLeftWidth", 85: "focusRingColor", 86: "focusRingOffset", 87: "rotate", 88: "gradientMidColor", 89: "gradientMidAt", 90: "gradientShape", 91: "brightness", 92: "saturate", 93: "contrast", 94: "invert", 95: "borderTopColor", 96: "borderRightColor", 97: "borderBottomColor", 98: "borderLeftColor", 99: "layout", 84: "zIndex" };

/** A length: logical pixels, a percentage string, or "auto". */
export type Length = number | `${number}%` | "auto";
/** A colour: "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", "transparent", or [r, g, b, a?] with r, g, b in 0–255 and a in 0–1. */
export type Color = string | readonly [number, number, number] | readonly [number, number, number, number];

/** Style properties as the core understands them (one wire property each). */
export interface WireStyle {
  /** Default: flex. */
  display?: "flex" | "none" | "grid";
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
  /** Default: relative (absolute: against the parent; fixed: against the window; sticky: stays within the nearest scroll view at the top/right/bottom/left distance given, inside its parent). */
  position?: "relative" | "absolute" | "fixed" | "sticky";
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
  /** Default: Inter, then the system's fonts. */
  fontFamily?: string | readonly string[];
  /** Default: 0. */
  shadowX?: number;
  /** Default: 0. */
  shadowY?: number;
  /** Default: 0 (a blur radius, like CSS's: twice the Gaussian's sigma). */
  shadowBlur?: number;
  /** Default: 0. */
  shadowSpread?: number;
  /** Default: transparent (no shadow). */
  shadowColor?: Color;
  /** Default: fill. */
  objectFit?: "fill" | "contain" | "cover";
  /** Default: 0. */
  translateX?: number;
  /** Default: 0. */
  translateY?: number;
  /** Default: 1. */
  scale?: number;
  /** Default: auto. */
  cursor?: "auto" | "default" | "pointer" | "text" | "grab" | "grabbing" | "notAllowed" | "move" | "crosshair" | "wait" | "progress" | "help" | "ewResize" | "nsResize" | "neswResize" | "nwseResize" | "colResize" | "rowResize" | "none";
  /** Default: none. */
  textDecoration?: "none" | "underline" | "lineThrough";
  /** Default: 0 (px added after each character). */
  letterSpacing?: number;
  /** Default: none. */
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  /** Default: normal (wraps; nowrap and pre keep one line per paragraph, pre is the same as nowrap: line breaks in the text are kept either way). */
  whiteSpace?: "normal" | "nowrap" | "pre";
  /** Default: ellipsis (what is cut off by maxLines or a nowrap line that is too wide ends in …). */
  textOverflow?: "ellipsis" | "clip";
  /** Default: normal (breakAll: break anywhere; keepAll: never inside a word; breakWord: only a word too long for the line breaks anywhere). */
  wordBreak?: "normal" | "breakAll" | "keepAll" | "breakWord";
  /** Default: none. */
  userSelect?: "none" | "text";
  /** Default: 0 (use gridMinColumnWidth, or one column): this many equal columns. */
  gridColumns?: number;
  /** Default: auto: as many columns as fit, each at least this wide and sharing the rest. */
  gridMinColumnWidth?: Length;
  /** Default: 1: columns an item covers. */
  gridColumnSpan?: number;
  /** Default: 1: rows an item covers. */
  gridRowSpan?: number;
  /** Default: 0 (none): width / height, for a box with one of them set. */
  aspectRatio?: number;
  /** Default: auto (none: the node is not under the pointer: presses, hover and the cursor go to what is below it). */
  pointerEvents?: "auto" | "none";
  /** Default: transparent (no gradient): the colour at the end of a gradient that starts with backgroundColor; any other colour counts, even a see-through one like #ffffff00 (fade out). */
  gradientColor?: Color;
  /** Default: 180 (degrees as in CSS: 180 runs top to bottom, 90 left to right). */
  gradientAngle?: number;
  /** Default: borderRadius. */
  borderTopLeftRadius?: number;
  /** Default: borderRadius. */
  borderTopRightRadius?: number;
  /** Default: borderRadius. */
  borderBottomRightRadius?: number;
  /** Default: borderRadius. */
  borderBottomLeftRadius?: number;
  /** Default: borderWidth. */
  borderTopWidth?: number;
  /** Default: borderWidth. */
  borderRightWidth?: number;
  /** Default: borderWidth. */
  borderBottomWidth?: number;
  /** Default: borderWidth. */
  borderLeftWidth?: number;
  /** Default: #3b82f6. */
  focusRingColor?: Color;
  /** Default: 2. */
  focusRingOffset?: number;
  /** Default: 0: degrees clockwise about the centre, with what's inside it (a view's clip and pointer follow; text fields inside it don't place the caret right). */
  rotate?: number;
  /** Default: transparent (none): a colour between backgroundColor and gradientColor, for three stops. */
  gradientMidColor?: Color;
  /** Default: 50 (percent of the way along the gradient where gradientMidColor is). */
  gradientMidAt?: number;
  /** Default: linear (radial: from the centre out to the corners; gradientAngle is ignored). */
  gradientShape?: "linear" | "radial";
  /** Default: 1: what's drawn in the view and inside it is made this many times brighter (0 black, 2 twice as bright). */
  brightness?: number;
  /** Default: 1: colour strength of what's drawn in the view and inside it (0 is grayscale). */
  saturate?: number;
  /** Default: 1: how far what's drawn in the view and inside it is from mid gray (0 is flat gray, 2 twice as far). */
  contrast?: number;
  /** Default: 0: 1 swaps every colour in the view and inside it for its opposite; in between mixes. */
  invert?: number;
  /** Default: borderColor: the top side's border colour (transparent = borderColor); the sides meet along the diagonals at the corners. */
  borderTopColor?: Color;
  /** Default: borderColor. */
  borderRightColor?: Color;
  /** Default: borderColor. */
  borderBottomColor?: Color;
  /** Default: borderColor. */
  borderLeftColor?: Color;
  /** Default: no value: only a key for `transition`, which animates the box to where layout puts it when it moves (siblings added, removed or reordered). */
  layout?: number;
  /** Default: 0: among its siblings, higher is painted (and hit) on top; ties keep tree order. */
  zIndex?: number;
}
