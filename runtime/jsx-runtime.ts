// JSX types for Mantou (tsconfig: "jsx": "preserve", "jsxImportSource":
// "mantou-ui"). JSX is compiled by Mantou's plugin (runtime/solid/plugin.ts),
// never through this module at run time.
import type { Node, PressEvent, TextLeaf, WheelEvent } from "./ui";
import type { StyleProp } from "./solid/renderer";

export type { StyleProp } from "./solid/renderer";

export interface ViewProps {
  style?: StyleProp;
  onPress?: (e: PressEvent) => void;
  /** Wheel and trackpad scrolling over this view (it bubbles, like presses). */
  onWheel?: (e: WheelEvent) => void;
  ref?: Node | ((node: Node) => void);
  children?: JSX.Element;
}

/** Text: its children are strings and numbers (no views inside). */
export interface TextProps {
  style?: StyleProp;
  onPress?: (e: PressEvent) => void;
  onWheel?: (e: WheelEvent) => void;
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
  /** In characters. */
  maxLength?: number;
  /** Focus it when it's created. */
  autoFocus?: boolean;
  /** The user changed the text. */
  onChange?: (value: string) => void;
  /** Enter in a single-line input, Ctrl/Cmd+Enter in a multiline one. */
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: (e: PressEvent) => void;
  onWheel?: (e: WheelEvent) => void;
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
