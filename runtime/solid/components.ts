// Mantou's components and Solid's control flow, typed for Mantou's JSX.
import { For as SolidFor, Index as SolidIndex, Match as SolidMatch, Show as SolidShow, Switch as SolidSwitch } from "./solid";
import type { InputProps, JSX, ScrollProps, TextProps, ViewProps } from "../jsx-runtime";
import type { KeyEvent, Node, Ui, WindowSize } from "../ui";
import { createElement, currentUi, spread } from "./renderer";
import { createSignal, onCleanup } from "./solid";

/** A box: flexbox layout, a background, press handling. */
export function View(props: ViewProps): JSX.Element {
  const node = createElement("view") as Node;
  spread(node, props, false);
  return node;
}

/** Text, laid out and drawn by the core. Style it with color, fontSize, fontWeight, lineHeight, textAlign, maxLines… */
export function Text(props: TextProps): JSX.Element {
  const node = createElement("text") as Node;
  spread(node, props, false);
  return node;
}

/**
 * A scroll view: the core scrolls it (wheel, trackpad, dragging its thumb),
 * with no round trip through JS. Its children go in a content view that
 * keeps their full size (it doesn't shrink), styled with `contentStyle`; its
 * `ref` is the scroll view, for `scrollTo`, `scrollBy` and `onScroll`.
 * Ancestors in a flex column usually need `minHeight: 0` so it can be
 * smaller than its content.
 */
export function Scroll(props: ScrollProps): JSX.Element {
  const outer = createElement("view") as Node;
  const inner = createElement("view") as Node;
  spread(
    outer,
    {
      get style() {
        return [{ overflow: "scroll", ...(props.scrollbar ? { scrollbar: props.scrollbar } : {}) }, props.style];
      },
      get onScroll() {
        return props.onScroll;
      },
      get onLayout() {
        return props.onLayout;
      },
      get onWheel() {
        return props.onWheel;
      },
      get ref() {
        return props.ref;
      },
    },
    true,
  );
  spread(
    inner,
    {
      get style() {
        return [{ flexShrink: 0 }, props.contentStyle];
      },
      get children() {
        return props.children;
      },
    },
    false,
  );
  outer.append(inner);
  return outer;
}

/**
 * A text field: single-line, or multiline. Uncontrolled with `defaultValue`,
 * or controlled with `value` and `onChange`. Style its text like <Text>'s,
 * and its box like a <View>'s.
 */
export function Input(props: InputProps): JSX.Element {
  const node = createElement("input") as Node;
  spread(node, props, false);
  return node;
}

/** Listens for keys anywhere in the window while the component is mounted. */
export function onKey(handler: (e: KeyEvent) => void) {
  onCleanup(currentUi().onKey(handler));
}

/**
 * The window's size in logical px, and its scale, as a signal that follows
 * resizes. Before the window has opened it reads 0 × 0.
 */
export function useWindowSize(): () => WindowSize {
  const ui = currentUi();
  const [size, setSize] = createSignal<WindowSize>(ui.windowSize ?? { width: 0, height: 0, scale: 1 });
  onCleanup(ui.onResize(setSize));
  return size;
}

/** The Ui the component is rendered in (to set the title, for example). */
export function useUi(): Ui {
  return currentUi();
}

type Each<T> = readonly T[] | undefined | null | false;

/** One child per item, keyed by item identity. */
export const For = SolidFor as unknown as <T>(props: {
  each: Each<T>;
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => JSX.Element;
}) => JSX.Element;

/** One child per index; the item at each index is a signal. */
export const Index = SolidIndex as unknown as <T>(props: {
  each: Each<T>;
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => JSX.Element;
}) => JSX.Element;

/** Its children while `when` is truthy, else `fallback`. */
export const Show = SolidShow as unknown as <T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element;
}) => JSX.Element;

export const Switch = SolidSwitch as unknown as (props: { fallback?: JSX.Element; children: JSX.Element }) => JSX.Element;
export const Match = SolidMatch as unknown as <T>(props: { when: T | undefined | null | false; children: JSX.Element }) => JSX.Element;
