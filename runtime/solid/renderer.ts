// Mantou's Solid renderer: solid-js/universal over the Worker's mirror tree
// (runtime/ui.ts). Compiled JSX imports its helpers from here
// ("mantou-ui/solid"). Nodes are released when the Solid owner that created
// them is disposed (design §7.4).
import { createRenderer } from "solid-js/universal";
import { createContext, getOwner, onCleanup, useContext } from "./solid";
import { Node, SharedStyle, TextLeaf, type Child, type PressEvent, type Style, type Ui, type WheelEvent } from "../ui";

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

const pressOff = new WeakMap<Node, () => void>();
const wheelOff = new WeakMap<Node, () => void>();

function setProperty(node: Child, name: string, value: unknown, prev: unknown) {
  if (!(node instanceof Node)) return;
  switch (name) {
    case "style":
      applyStyle(node, value as StyleProp, prev as StyleProp);
      return;
    case "onPress":
      pressOff.get(node)?.();
      pressOff.delete(node);
      if (typeof value === "function") pressOff.set(node, node.onPress(value as (e: PressEvent) => void));
      return;
    case "onWheel":
      wheelOff.get(node)?.();
      wheelOff.delete(node);
      if (typeof value === "function") wheelOff.set(node, node.onWheel(value as (e: WheelEvent) => void));
      return;
    default:
      throw new Error(`mantou: <${node.isText ? "Text" : "View"}> has no property "${name}"`);
  }
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
    if (tag !== "view" && tag !== "text") throw new Error(`mantou: unknown element <${tag}>; use <View> or <Text>`);
    const node = tag === "text" ? currentUi().textNode() : currentUi().view();
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
