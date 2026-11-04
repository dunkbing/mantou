// Mantou's components and Solid's control flow, typed for Mantou's JSX.
import { For as SolidFor, Index as SolidIndex, Match as SolidMatch, Show as SolidShow, Switch as SolidSwitch } from "./solid";
import type { ImageProps, InputProps, JSX, ListHandle, ListProps, ScrollProps, TextProps, ViewProps } from "../jsx-runtime";
import type { KeyEvent, Node, Ui, WindowSize } from "../ui";
import { createElement, currentUi, insert, spread } from "./renderer";
import { createEffect, createMemo, createRoot, createSignal, getOwner, onCleanup } from "./solid";

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
 * An image: PNG, JPEG, WebP or SVG, from a file path or bytes. Without a
 * width and height it takes its natural size (keeping its aspect ratio when
 * one is set); `objectFit` places it in its box, `borderRadius` rounds it,
 * and `color` tints it (its alpha, in that colour: for icons).
 */
export function Image(props: ImageProps): JSX.Element {
  const node = createElement("image") as Node;
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
      get onHover() {
        return props.onHover;
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
 * A virtualized list: only the rows in view (and `overscan` more on each
 * side) exist, so a list of 100,000 items costs what one screenful does. The
 * core scrolls it like any scroll view; rows come and go as `onScroll` tells
 * the list where it is. Rows are `itemHeight` px tall; `ref` gets a handle
 * with `scrollToIndex`, which works for rows that don't exist yet.
 */
export function List<T>(props: ListProps<T>): JSX.Element {
  const owner = getOwner();
  const [offset, setOffset] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  const outer = createElement("view") as Node;
  const inner = createElement("view") as Node;
  const rows = new Map<number, () => void>();
  const size = (h: number) => (Number.isFinite(h) && h > 0 ? h : 0);
  // Where each row starts: offsets[i], and offsets[n] is the content's height.
  // A fixed height needs no table; a function is called once per item each
  // time `each` (or anything it reads) changes.
  const layout = createMemo(() => {
    const each = props.each, ih = props.itemHeight;
    if (typeof ih === "number") {
      const h = Math.max(1, size(ih));
      return { n: each.length, top: (i: number) => i * h, at: (y: number) => Math.floor(y / h), before: (y: number) => Math.ceil(y / h) };
    }
    const offsets = new Float64Array(each.length + 1);
    for (let i = 0; i < each.length; i++) offsets[i + 1] = offsets[i] + size(ih(each[i], i));
    return {
      n: each.length,
      top: (i: number) => offsets[i],
      // The last row starting at or above y.
      at: (y: number) => {
        let lo = 0, hi = each.length;
        while (hi - lo > 1) {
          const mid = (lo + hi) >>> 1;
          if (offsets[mid] <= y) lo = mid;
          else hi = mid;
        }
        return lo;
      },
      // How many rows start above y.
      before: (y: number) => {
        let lo = 0, hi = each.length + 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (offsets[mid] < y) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
    };
  });
  const range = createMemo<[number, number]>(
    () => {
      const { n, at, before } = layout(), over = props.overscan ?? 4;
      if (n === 0) return [0, 0];
      const first = Math.max(0, at(offset()) - over);
      const last = Math.min(n, Math.max(first + 1, before(offset() + Math.max(viewport(), 1))) + over);
      return [first, Math.max(first, last)];
    },
    [0, 0],
    { equals: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  const handle: ListHandle = {
    get node() {
      return outer;
    },
    range: () => range(),
    scrollToIndex(index, options = {}) {
      const { n, top: topOf } = layout();
      if (n === 0) return;
      const i = Math.max(0, Math.min(index, n - 1)), vp = viewport(), y = offset();
      const top = topOf(i), bottom = topOf(i + 1);
      const to = { start: top, end: bottom - vp, center: (top + bottom) / 2 - vp / 2, nearest: top < y || bottom - top > vp ? top : bottom > y + vp ? bottom - vp : y }[options.block ?? "nearest"];
      outer.scrollTo({ y: to });
    },
  };
  spread(
    outer,
    {
      get style() {
        return [{ overflow: "scroll", ...(props.scrollbar ? { scrollbar: props.scrollbar } : {}) }, props.style];
      },
      onScroll: (o: { x: number; y: number }) => {
        setOffset(o.y);
        props.onScroll?.(o);
      },
      onLayout: (r: { height: number }) => setViewport(r.height),
    },
    true,
  );
  spread(
    inner,
    {
      get style() {
        const { n, top } = layout();
        return [{ flexShrink: 0, height: top(n) }, props.contentStyle];
      },
    },
    true,
  );
  outer.append(inner);
  // Rows in range exist; the others are disposed (their nodes released).
  createEffect(() => {
    const [first, last] = range();
    for (const [i, dispose] of rows) {
      if (i < first || i >= last) {
        dispose();
        rows.delete(i);
      }
    }
    for (let i = first; i < last; i++) {
      if (rows.has(i)) continue;
      createRoot((dispose) => {
        const row = createElement("view") as Node;
        // Its place follows the heights: a row above that grows moves it, with no new row.
        createEffect(() => {
          const { n, top } = layout();
          if (i >= n) return; // past the end: the range effect is about to dispose this row
          row.style({ position: "absolute", left: 0, right: 0, top: top(i), height: top(i + 1) - top(i) });
        });
        insert(row, () => props.children(() => props.each[i], i));
        inner.append(row);
        rows.set(i, dispose);
      }, owner ?? undefined);
    }
  });
  onCleanup(() => {
    for (const dispose of rows.values()) dispose();
    rows.clear();
  });
  props.ref?.(handle);
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
