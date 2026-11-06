// JSX types for Mantou (tsconfig: "jsx": "preserve", "jsxImportSource":
// "mantou-ui"). JSX is compiled by Mantou's plugin (runtime/solid/plugin.ts),
// never through this module at run time.
import type { AccessRoleName, DropEvent, EnterSpec, ExitSpec, HtmlLoader, KeyEvent, Node, PointerEvent, PressEvent, Rect, ScrollOffset, TextLeaf, Transitions, WheelEvent } from "./ui";
import type { StyleProp } from "./solid/renderer";
import type { CanvasContext } from "./canvas";

export type { StyleProp } from "./solid/renderer";

/** What screen readers are told about a node (design §10); see `Node.access`. */
/** For tests and tools: a stable name to find the node by (`h.find("save")`, `h.press("save")`, `mantou snap`'s scripts). */
export interface TestProps {
  testId?: string;
}

export interface AccessProps extends TestProps {
  /** Default: from the kind (Text a label, Input a text field, a View with onPress a button). "none" leaves the node itself out. */
  role?: AccessRoleName;
  /** Its name; default: the text inside it. */
  label?: string;
  /** For checkbox, switch, radio and menuItem roles; "mixed" for in between. */
  checked?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
  /** For what opens and closes (a tree item, a disclosure): open or closed. */
  expanded?: boolean;
  /** Leave the node and what's inside it out. */
  accessHidden?: boolean;
}

/** Pointer handlers (they bubble, like presses). */
export interface PointerProps {
  /** A button went down on the node or inside it. */
  onPointerDown?: (e: PointerEvent) => void;
  /** The pointer moved over it, or anywhere while a button held that went down on it (a drag). At most one per batch. */
  onPointerMove?: (e: PointerEvent) => void;
  /** A button came up; after a press on the node, wherever the pointer is. */
  onPointerUp?: (e: PointerEvent) => void;
  /** The secondary button went down (macOS: also Control + the primary one): where `showMenu` goes. */
  onContextMenu?: (e: PointerEvent) => void;
  /** The primary button went down for the second time in a row at one spot. */
  onDoubleClick?: (e: PointerEvent) => void;
  /**
   * The user can select the text (drag, double click for a word, triple click for a line, shift-click to extend)
   * and copy it. On a view, all the Text inside is selectable as one selection, across Texts. Same as `style={{ userSelect: "text" }}`.
   */
  selectable?: boolean;
  /** Pressing the primary button on this view moves the window (a custom title bar, with `frameless`). */
  dragRegion?: boolean;
  /** Makes the view draggable inside the app, carrying this value: views under it get `onDragOver` and `onDrop` events with `data` set to it. */
  draggable?: unknown;
  /** Drawn under the pointer while the view is dragged, held where it was grabbed (made when the drag starts). Style its root to size it. */
  dragPreview?: () => JSX.Element;
  /** Files (or a dragged view) were dropped on the node or inside it. Needs the OS to report the pointer's position, so the target is where it last was. */
  onDrop?: (e: DropEvent) => void;
  /** Files are held over the node (the event), or left it or the window (null): the place for a highlight. */
  onDragOver?: (e: DropEvent | null) => void;
}

/** Keyboard focus for views (dunkbing/mantou#17). */
export interface FocusProps {
  /**
   * It can take the keyboard focus: a press or Tab focuses it (the core draws
   * a ring when it came from the keyboard; style it with `focusRingColor` and
   * `focusRingOffset`), Enter and Space press it, and a focused scroll view
   * scrolls with the keys.
   */
  focusable?: boolean;
  /** -1: focusable, but Tab passes it by; 1, 2…: Tab visits it in that order first. Makes the view focusable. */
  tabIndex?: number;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Keys while it (or something inside it) has the focus, innermost first, before the window's `onKey` handlers. */
  onKey?: (e: KeyEvent) => void;
}

export interface ViewProps extends AccessProps, PointerProps, FocusProps {
  style?: StyleProp;
  /** Properties that animate to their new values when they change: `{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }` (ms). */
  transition?: Transitions;
  /** The pointer came over this node (or anything inside it): `true`; it left: `false`. Tracked by the core. Set the pointer's shape with the `cursor` style. */
  onHover?: (hovered: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  /** Starts from these values when created: `{ from: { opacity: 0, translateY: 12 } }`. */
  enter?: EnterSpec;
  /** Stays and moves to these values when removed, then goes: `{ to: { opacity: 0 } }`. */
  exit?: ExitSpec;
  /**
   * A focus scope, for dialogs: while it's on screen, Tab and Shift+Tab stay
   * among the inputs inside the topmost scope, and when it leaves the screen
   * the focus goes back to the input that had it before it opened.
   */
  focusScope?: boolean;
  /** A scroll view's offset after the core scrolls it (with `style={{ overflow: "scroll" }}`). */
  onScroll?: (offset: ScrollOffset) => void;
  onPress?: (e: PressEvent) => void;
  /** Wheel and trackpad scrolling over this view (it bubbles, like presses). */
  onWheel?: (e: WheelEvent) => void;
  /** This node's box (logical px from the window's top left), after the first layout and whenever it changes. */
  onLayout?: (rect: Rect) => void;
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** A drawing surface (see `Canvas`). */
export interface CanvasProps extends TestProps {
  /** Size in logical px (also settable in `style`). */
  width?: number;
  height?: number;
  style?: StyleProp;
  /** Draws the canvas. It runs again whenever a signal it reads changes. */
  draw: (g: CanvasContext) => void;
}

/** A virtualized list (see `List`). */
export interface ListProps<T> {
  each: readonly T[];
  /**
   * Rows' heights, in px: one for every row, or a function of the item and
   * its index, for rows of different heights known from the data (it runs for
   * every item when `each`, or a signal it reads, changes).
   */
  itemHeight: number | ((item: T, index: number) => number);
  /** Rows kept beyond each edge of the view (default 4). */
  overscan?: number;
  style?: StyleProp;
  contentStyle?: StyleProp;
  scrollbar?: "auto" | "none";
  onScroll?: (offset: ScrollOffset) => void;
  /** A row: `item` reads the current item at `index` (it follows changes to `each`). */
  children: (item: () => T, index: number) => JSX.Element;
  ref?: (list: ListHandle) => void;
}

export interface ListHandle {
  /** The scroll view. */
  readonly node: Node;
  /** The rows that exist now: [first, last). */
  range(): [number, number];
  /** Scrolls so the row shows ("nearest" by default, also "start", "center", "end"), rendered or not. */
  scrollToIndex(index: number, options?: { block?: "nearest" | "start" | "center" | "end" }): void;
}

/** An image (see `Image`). */
export interface ImageProps extends TestProps {
  /** A PNG, JPEG, WebP or SVG: a path (relative to the working directory) or the file's bytes. */
  src: string | Uint8Array;
  style?: StyleProp;
  /** The source was decoded: its natural size (logical px). */
  onLoad?: (size: { width: number; height: number }) => void;
  /** The source couldn't be read or decoded. */
  onError?: (message: string) => void;
  /** Properties that animate to their new values when they change: `{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }` (ms). */
  transition?: Transitions;
  /** The pointer came over this node (or anything inside it): `true`; it left: `false`. Tracked by the core. Set the pointer's shape with the `cursor` style. */
  onHover?: (hovered: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onPress?: (e: PressEvent) => void;
  onLayout?: (rect: Rect) => void;
  ref?: Node | ((node: Node) => void);
}

/** A static HTML/CSS document drawn by the core (see `Html`). */
export interface HtmlProps extends TestProps {
  /** The document: HTML with its CSS (inline, or in `<style>`). No scripts run, and nothing is fetched but through `loadImage`. */
  html: string;
  /** What the document's `prefers-color-scheme` answers (default "light"). */
  colorScheme?: "light" | "dark";
  /** The bytes of an image (or stylesheet) the document asks for, or null to leave it out: `cid:` parts, remote ones once allowed. Asked once per URL; `data:` URLs need none. */
  loadImage?: HtmlLoader;
  /** A link was pressed: its href. The view never navigates. */
  onLink?: (url: string) => void;
  /** Its width comes from the layout (`width: "100%"` or a flex parent's); its height follows the document. */
  style?: StyleProp;
  onLayout?: (rect: Rect) => void;
  onHover?: (hovered: boolean) => void;
  onPress?: (e: PressEvent) => void;
  ref?: Node | ((node: Node) => void);
}

/** A scroll view (see `Scroll`). */
export interface ScrollProps extends AccessProps, PointerProps, FocusProps {
  /** The scroll view's own style; `overflow: "scroll"` is set for you. */
  style?: StyleProp;
  /** The style of the content view inside, which holds the children. */
  contentStyle?: StyleProp;
  /** "auto" (default): a thumb over the content while it overflows, which can be dragged; "none": no thumb. */
  scrollbar?: "auto" | "none";
  /** The offset after the core scrolls it, at most once per frame. */
  onScroll?: (offset: ScrollOffset) => void;
  onLayout?: (rect: Rect) => void;
  onWheel?: (e: WheelEvent) => void;
  onHover?: (hovered: boolean) => void;
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** Text: its children are strings and numbers (no views inside). */
export interface TextProps extends AccessProps, PointerProps {
  style?: StyleProp;
  /** Properties that animate to their new values when they change: `{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }` (ms). */
  transition?: Transitions;
  /** The pointer came over this node (or anything inside it): `true`; it left: `false`. Tracked by the core. Set the pointer's shape with the `cursor` style. */
  onHover?: (hovered: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onPress?: (e: PressEvent) => void;
  onWheel?: (e: WheelEvent) => void;
  /** This node's box (logical px from the window's top left), after the first layout and whenever it changes. */
  onLayout?: (rect: Rect) => void;
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** A text field. Keys it uses (typing, arrows, shortcuts like copy) don't reach onKey handlers. */
export interface InputProps extends AccessProps {
  /** Controlled: the text. Keep it in sync with onChange, or the input goes back to it. */
  value?: string;
  /** Uncontrolled: the text it starts with. */
  defaultValue?: string;
  /** What it shows while empty. */
  placeholder?: string;
  /** Enter adds a line (Ctrl/Cmd+Enter submits), and it grows with its text. */
  multiline?: boolean;
  readOnly?: boolean;
  /**
   * A password field: the core draws a bullet per character, refuses copy and
   * cut (paste still works), and tells the OS so it turns the IME off. Flip it
   * for a "show password" toggle.
   */
  secure?: boolean;
  /** In characters. */
  /** The characters typing and pasting may add, checked in the core: `"0-9."` (characters and ranges), `"^<>"` for all but those. */
  allow?: string;
  /** The caret or selection moved (UTF-16 units; `start === end` is a caret). */
  onSelect?: (s: { start: number; end: number; anchor: number; focus: number }) => void;
  maxLength?: number;
  /** Focus it when it's created. Later changes to it do nothing (use `node.focus()`). */
  autoFocus?: boolean;
  /** The user changed the text. */
  onChange?: (value: string) => void;
  /** Enter in a single-line input, Ctrl/Cmd+Enter in a multiline one. */
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: (e: PressEvent) => void;
  onWheel?: (e: WheelEvent) => void;
  /** This node's box (logical px from the window's top left), after the first layout and whenever it changes. */
  onLayout?: (rect: Rect) => void;
  /** Properties that animate to their new values when they change: `{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }` (ms). */
  transition?: Transitions;
  /** The pointer came over this node (or anything inside it): `true`; it left: `false`. Tracked by the core. Set the pointer's shape with the `cursor` style. */
  onHover?: (hovered: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  style?: StyleProp;
  ref?: Node | ((node: Node) => void);
}

export namespace JSX {
  export type Element = Node | TextLeaf | ArrayElement | (() => Element) | string | number | boolean | null | undefined;
  export interface ArrayElement extends Array<Element> {}
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    view: ViewProps;
    text: TextProps;
    input: InputProps;
    image: ImageProps;
    html: HtmlProps;
  }
  export interface IntrinsicAttributes {}
}

function notCompiled(): never {
  throw new Error("mantou: this JSX wasn't compiled by Mantou's plugin; run the app with `bun runtime/main.ts`, or preload runtime/solid/preload.ts");
}
export const jsx = notCompiled;
export const jsxs = notCompiled;
export const jsxDEV = notCompiled;
export const Fragment = notCompiled;
