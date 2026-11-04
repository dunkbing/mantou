// Mantou's Solid renderer: solid-js/universal over the Worker's mirror tree
// (runtime/ui.ts). Compiled JSX imports its helpers from here
// ("mantou-ui/solid"). Nodes are released when the Solid owner that created
// them is disposed (design §7.4).
import { createRenderer } from "solid-js/universal";
import { createContext, getOwner, onCleanup, useContext } from "./solid";
import { Node, SharedStyle, TextLeaf, type Child, type PressEvent, type Rect, type ScrollOffset, type Style, type Ui, type WheelEvent } from "../ui";

/** The Ui that elements are created in, provided by mount(). */
export const UiContext = createContext<Ui>();

export function currentUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("mantou: elements must be created inside mount() or run()");
  return ui;
}

/** What `style` accepts: own properties, a shared style, or a list of them (later entries win). */
export type StyleProp = Style | SharedStyle | false | null | undefined | readonly StyleProp[];

function flatten(v: StyleProp, out: { shared: SharedStyle | null; own: Record<string, unknown> }) {
  if (!v) return out;
  if (v instanceof SharedStyle) out.shared = v;
  else if (Array.isArray(v)) for (const item of v) flatten(item, out);
  else Object.assign(out.own, v);
  return out;
}

function applyStyle(node: Node, value: StyleProp, prev: StyleProp) {
  const next = flatten(value, { shared: null, own: {} });
  const old = flatten(prev, { shared: null, own: {} });
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(old.own)) if (!(key in next.own)) patch[key] = undefined;
  Object.assign(patch, next.own);
  node.use(next.shared);
  node.style(patch as Style);
}

/** Per node, the function that removes each handler prop's current handler. */
const handlerOff = new WeakMap<Node, Map<string, () => void>>();

function setHandler(node: Node, name: string, value: unknown, add: (f: never) => () => void) {
  let offs = handlerOff.get(node);
  if (!offs) handlerOff.set(node, (offs = new Map()));
  offs.get(name)?.();
  offs.delete(name);
  if (typeof value === "function") offs.set(name, add(value as never));
}

/** Inputs whose autoFocus was read: it counts only when the input is created (dunkbing/mantou#4). */
const autoFocusRead = new WeakSet<Node>();

const inputEvents: Record<string, "change" | "submit" | "focus" | "blur"> = { onChange: "change", onSubmit: "submit", onFocus: "focus", onBlur: "blur" };

function setInputProperty(node: Node, name: string, value: unknown, prev: unknown): boolean {
  switch (name) {
    case "value":
      node.control(value === undefined || value === null ? undefined : String(value));
      return true;
    case "defaultValue":
      if (prev === undefined && value !== undefined && value !== null) node.setValue(String(value));
      return true;
    case "placeholder":
      node.placeholder(value === undefined || value === null ? "" : String(value));
      return true;
    case "multiline":
    case "readOnly":
    case "secure":
      node.setOptions({ [name]: !!value });
      return true;
    case "maxLength":
      node.setOptions({ maxLength: Number(value ?? 0) });
      return true;
    case "autoFocus":
      // Its first value (set while the input is created) decides; later ones
      // don't move the focus, as in the DOM. Call node.focus() for that.
      if (!autoFocusRead.has(node)) {
        autoFocusRead.add(node);
        if (value) node.focus();
      }
      return true;
  }
  const type = inputEvents[name];
  if (!type) return false;
  setHandler(node, name, value, (f) => node.onInput(type, f));
  return true;
}

function setProperty(node: Child, name: string, value: unknown, prev: unknown) {
  if (!(node instanceof Node)) return;
  switch (name) {
    case "style":
      applyStyle(node, value as StyleProp, prev as StyleProp);
      return;
    case "onPress":
      setHandler(node, name, value, (f: (e: PressEvent) => void) => node.onPress(f));
      return;
    case "onWheel":
      setHandler(node, name, value, (f: (e: WheelEvent) => void) => node.onWheel(f));
      return;
    case "onLayout":
      setHandler(node, name, value, (f: (rect: Rect) => void) => node.onLayout(f));
      return;
    case "onScroll":
      setHandler(node, name, value, (f: (offset: ScrollOffset) => void) => node.onScroll(f));
      return;
    case "focusScope":
      node.focusScope(!!value);
      return;
  }
  if (node.isInput && setInputProperty(node, name, value, prev)) return;
  if (node.isImage) {
    if (name === "src") {
      if (value !== undefined && value !== null && value !== prev) node.src(value as string | Uint8Array);
      return;
    }
    if (name === "onLoad") return setHandler(node, name, value, (f: (s: { width: number; height: number }) => void) => node.onImageLoad(f));
    if (name === "onError") return setHandler(node, name, value, (f: (m: string) => void) => node.onImageError(f));
  }
  throw new Error(`mantou: <${node.kindName}> has no property "${name}"`);
}

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<Child>({
  createElement(tag) {
    const ui = currentUi();
    const node = tag === "view" ? ui.view() : tag === "text" ? ui.textNode() : tag === "input" ? ui.input() : tag === "image" ? ui.image() : null;
    if (!node) throw new Error(`mantou: unknown element <${tag}>; use <View>, <Text>, <Input> or <Image>`);
    if (getOwner()) onCleanup(() => node.release());
    return node;
  },
  createTextNode: (value) => new TextLeaf(value),
  replaceText(node, value) {
    (node as TextLeaf).text = value;
  },
  isTextNode: (node) => node instanceof TextLeaf,
  setProperty,
  insertNode(parent, node, anchor) {
    (parent as Node).insertBefore(node, anchor ?? null);
  },
  removeNode(parent, node) {
    (parent as Node).remove(node);
  },
  getParentNode: (node) => node.parent ?? undefined,
  getFirstChild: (node) => (node instanceof Node ? node.children[0] : undefined),
  getNextSibling(node) {
    const siblings = node.parent?.children;
    return siblings ? siblings[siblings.indexOf(node) + 1] : undefined;
  },
});
