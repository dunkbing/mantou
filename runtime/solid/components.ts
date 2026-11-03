// Mantou's components and Solid's control flow, typed for Mantou's JSX.
import { For as SolidFor, Index as SolidIndex, Match as SolidMatch, Show as SolidShow, Switch as SolidSwitch } from "./solid";
import type { JSX, TextProps, ViewProps } from "../jsx-runtime";
import type { KeyEvent, Node, Ui } from "../ui";
import { createElement, currentUi, spread } from "./renderer";
import { onCleanup } from "./solid";

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

/** Listens for keys anywhere in the window while the component is mounted. */
export function onKey(handler: (e: KeyEvent) => void) {
  onCleanup(currentUi().onKey(handler));
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
