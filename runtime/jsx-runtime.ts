// JSX types for Mantou (tsconfig: "jsx": "preserve", "jsxImportSource":
// "mantou-ui"). JSX is compiled by Mantou's plugin (runtime/solid/plugin.ts),
// never through this module at run time.
import type { AccessRoleName, DropEvent, Node, PointerEvent, PressEvent, Rect, ScrollOffset, TextLeaf, Transitions, WheelEvent } from "./ui";
import type { StyleProp } from "./solid/renderer";

export type { StyleProp } from "./solid/renderer";

/** What screen readers are told about a node (design §10); see `Node.access`. */
export interface AccessProps {
  /** Default: from the kind (Text a label, Input a text field, a View with onPress a button). "none" leaves the node itself out. */
  role?: AccessRoleName;
  /** Its name; default: the text inside it. */
  label?: string;
  /** For checkbox, switch, radio and menuItem roles; "mixed" for in between. */
  checked?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
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
  /** Files (or a dragged view) were dropped on the node or inside it. Needs the OS to report the pointer's position, so the target is where it last was. */
  onDrop?: (e: DropEvent) => void;
  /** Files are held over the node (the event), or left it or the window (null): the place for a highlight. */
  onDragOver?: (e: DropEvent | null) => void;
}

export interface ViewProps extends AccessProps, PointerProps {
  style?: StyleProp;
  /** Properties that animate to their new values when they change: `{ opacity: 200, scale: { duration: 150, easing: "ease-out" } }` (ms). */
  transition?: Transitions;
  /** The pointer came over this node (or anything inside it): `true`; it left: `false`. Tracked by the core. Set the pointer's shape with the `cursor` style. */
  onHover?: (hovered: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
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
export interface ImageProps {
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

/** A scroll view (see `Scroll`). */
export interface ScrollProps extends AccessProps, PointerProps {
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
