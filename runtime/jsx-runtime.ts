// JSX types for Mantou (tsconfig: "jsx": "preserve", "jsxImportSource":
// "mantou-ui"). JSX is compiled by Mantou's plugin (runtime/solid/plugin.ts),
// never through this module at run time.
import type { Node, PressEvent, Rect, ScrollOffset, TextLeaf, WheelEvent } from "./ui";
import type { StyleProp } from "./solid/renderer";

export type { StyleProp } from "./solid/renderer";

export interface ViewProps {
  style?: StyleProp;
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

/** An image (see `Image`). */
export interface ImageProps {
  /** A PNG, JPEG, WebP or SVG: a path (relative to the working directory) or the file's bytes. */
  src: string | Uint8Array;
  style?: StyleProp;
  /** The source was decoded: its natural size (logical px). */
  onLoad?: (size: { width: number; height: number }) => void;
  /** The source couldn't be read or decoded. */
  onError?: (message: string) => void;
  onPress?: (e: PressEvent) => void;
  onLayout?: (rect: Rect) => void;
  ref?: Node | ((node: Node) => void);
}

/** A scroll view (see `Scroll`). */
export interface ScrollProps {
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
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** Text: its children are strings and numbers (no views inside). */
export interface TextProps {
  style?: StyleProp;
  onPress?: (e: PressEvent) => void;
  onWheel?: (e: WheelEvent) => void;
  /** This node's box (logical px from the window's top left), after the first layout and whenever it changes. */
  onLayout?: (rect: Rect) => void;
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** A text field. Keys it uses (typing, arrows, shortcuts like copy) don't reach onKey handlers. */
export interface InputProps {
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
