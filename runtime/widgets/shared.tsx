// What the components share: the state they track (hover, press, focus), their `style` that may be a function
// of it, labels from strings, and a chevron.
import { Image, Text } from "../solid/components";
import { createSignal } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import type { PointerEvent } from "../ui";

/** What a component's look can depend on. */
export interface WidgetState {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  disabled: boolean;
}

/** A style, or a function of the component's state that returns one. */
export type WidgetStyle<S = WidgetState> = StyleProp | ((state: S) => StyleProp);

/** @internal Hover, press and focus state for a view, and the handlers that track them. */
export function useInteraction(disabled: () => boolean | undefined) {
  const [hovered, setHovered] = createSignal(false);
  const [pressed, setPressed] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const state = (): WidgetState => ({ hovered: hovered(), pressed: pressed(), focused: focused(), disabled: !!disabled() });
  const handlers = {
    onHover: (h: boolean) => {
      setHovered(h);
      if (!h) setPressed(false);
    },
    onPointerDown: (e: PointerEvent) => e.button === 0 && !disabled() && setPressed(true),
    onPointerUp: () => setPressed(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
  return { state, handlers };
}

/** @internal */
export function resolve<S>(style: WidgetStyle<S> | undefined, state: S): StyleProp {
  return typeof style === "function" ? style(state) : style;
}

/** @internal Strings and numbers as Text; anything else as it is. */
export function label(children: JSX.Element, style: () => StyleProp): JSX.Element {
  return typeof children === "string" || typeof children === "number" ? <Text style={style()}>{children}</Text> : children;
}

/** @internal */
export const isMac = process.platform === "darwin";

/** A chevron, pointing right; turned 90° when open. */
const CHEVRON = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

export function Chevron(props: { open: boolean; size?: number }): JSX.Element {
  const size = props.size ?? 14;
  return <Image src={CHEVRON} transition={{ rotate: { duration: 150, easing: "ease-out" } }} style={{ width: size, height: size, flexShrink: 0, color: theme.dimText, rotate: props.open ? 90 : 0 }} />;
}
