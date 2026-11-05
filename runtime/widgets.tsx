// Base components (dunkbing/mantou#22): Button, Checkbox, Toggle (a switch), RadioGroup,
// Slider, Tabs, Dialog, Tooltip and Splitter, built on the primitives. Each
// is accessible (a role, focus, the keyboard) and takes a `style`, either a
// style or a function of the component's state (hovered, pressed, focused,
// and its own: checked, selected…), laid over a plain default look. Keys follow
// the platforms': Space and Enter press, arrows move in groups.
import { Image, Show, Text, View, onKey } from "./solid/components";
import { For } from "./solid/components";
import { createSignal, onCleanup } from "./solid/solid";
import type { JSX, StyleProp } from "./jsx-runtime";
import type { KeyEvent, PointerEvent } from "./ui";

/** What a component's look can depend on. */
export interface WidgetState {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  disabled: boolean;
}

/** A style, or a function of the component's state that returns one. */
export type WidgetStyle<S = WidgetState> = StyleProp | ((state: S) => StyleProp);

const ACCENT = "#2563eb";
const BORDER = "#9ca3af";
const MUTED = "#e5e7eb";

/** Hover, press and focus state for a view, and the handlers that track them. */
function useInteraction(disabled: () => boolean | undefined) {
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

function resolve<S>(style: WidgetStyle<S> | undefined, state: S): StyleProp {
  return typeof style === "function" ? style(state) : style;
}

/** Strings and numbers as Text; anything else as it is. */
function label(children: JSX.Element, style: StyleProp): JSX.Element {
  return typeof children === "string" || typeof children === "number" ? <Text style={style}>{children}</Text> : children;
}

// ---------------------------------------------------------------------------

export interface ButtonProps {
  onPress?: () => void;
  disabled?: boolean;
  /** "primary" (filled, the default), "secondary" (outlined) or "ghost" (text only). */
  variant?: "primary" | "secondary" | "ghost";
  /** A name for screen readers, if the content isn't text. */
  label?: string;
  style?: WidgetStyle;
  children?: JSX.Element;
}

/** A button: pressed with the pointer, or Enter or Space when focused. */
export function Button(props: ButtonProps): JSX.Element {
  const { state, handlers } = useInteraction(() => props.disabled);
  const primary = () => (props.variant ?? "primary") === "primary";
  const look = (s: WidgetState): StyleProp => {
    const v = props.variant ?? "primary";
    const bg = v === "primary" ? (s.pressed ? "#1e40af" : s.hovered ? "#1d4ed8" : ACCENT) : s.pressed ? "#d1d5db" : s.hovered ? "#f3f4f6" : "transparent";
    return {
      height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
      backgroundColor: bg, borderWidth: v === "secondary" ? 1 : 0, borderColor: BORDER,
      opacity: s.disabled ? 0.5 : 1, cursor: s.disabled ? "notAllowed" : "pointer",
    };
  };
  return (
    <View
      {...handlers}
      role="button"
      label={props.label}
      disabled={props.disabled}
      focusable={!props.disabled}
      onPress={() => !props.disabled && props.onPress?.()}
      transition={{ backgroundColor: 100 }}
      style={[look(state()), resolve(props.style, state())]}
    >
      {label(props.children, { color: primary() ? "#ffffff" : "#111827", fontWeight: 500 })}
    </View>
  );
}

// ---------------------------------------------------------------------------

/** A checkmark, as an SVG tinted with the Image's `color`. */
const CHECK = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: JSX.Element;
  style?: WidgetStyle<WidgetState & { checked: boolean }>;
}

/** A checkbox with its label: Space (or a press) toggles it. */
export function Checkbox(props: CheckboxProps): JSX.Element {
  const { state, handlers } = useInteraction(() => props.disabled);
  const s = () => ({ ...state(), checked: props.checked });
  return (
    <View
      {...handlers}
      role="checkbox"
      checked={props.checked}
      disabled={props.disabled}
      focusable={!props.disabled}
      onPress={() => !props.disabled && props.onChange?.(!props.checked)}
      style={[{ flexDirection: "row", alignItems: "center", gap: 8, cursor: props.disabled ? "notAllowed" : "pointer", opacity: props.disabled ? 0.5 : 1, focusRingOffset: 1, borderRadius: 4 }, resolve(props.style, s())]}
    >
      <View
        transition={{ backgroundColor: 100, borderColor: 100 }}
        style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, flexShrink: 0, justifyContent: "center", alignItems: "center", borderColor: props.checked ? ACCENT : state().hovered ? "#6b7280" : BORDER, backgroundColor: props.checked ? ACCENT : "#ffffff" }}
      >
        <Show when={props.checked}>
          <Image src={CHECK} style={{ width: 14, height: 14, color: "#ffffff" }} />
        </Show>
      </View>
      {label(props.children, { color: "#111827" })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ToggleProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: JSX.Element;
  style?: WidgetStyle<WidgetState & { checked: boolean }>;
}

/** A switch, on or off, with its knob sliding across (`Switch` is Solid's control flow). */
export function Toggle(props: ToggleProps): JSX.Element {
  const { state, handlers } = useInteraction(() => props.disabled);
  const s = () => ({ ...state(), checked: props.checked });
  return (
    <View
      {...handlers}
      role="switch"
      checked={props.checked}
      disabled={props.disabled}
      focusable={!props.disabled}
      onPress={() => !props.disabled && props.onChange?.(!props.checked)}
      style={[{ flexDirection: "row", alignItems: "center", gap: 8, cursor: props.disabled ? "notAllowed" : "pointer", opacity: props.disabled ? 0.5 : 1, borderRadius: 10 }, resolve(props.style, s())]}
    >
      <View transition={{ backgroundColor: 150 }} style={{ width: 36, height: 20, borderRadius: 10, flexShrink: 0, padding: 2, backgroundColor: props.checked ? ACCENT : "#d1d5db" }}>
        <View transition={{ translateX: { duration: 150, easing: "ease-out" } }} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#ffffff", translateX: props.checked ? 16 : 0, boxShadow: { y: 1, blur: 2, color: "#0003" } }} />
      </View>
      {label(props.children, { color: "#111827" })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface RadioOption<T> {
  value: T;
  label: JSX.Element;
  disabled?: boolean;
}

export interface RadioGroupProps<T> {
  value: T | undefined;
  options: readonly RadioOption<T>[];
  onChange?: (value: T) => void;
  /** "column" (default) or "row". */
  direction?: "row" | "column";
  label?: string;
  style?: StyleProp;
}

/**
 * Radio buttons, one of which is chosen. Tab reaches the group once (its
 * chosen option), and the arrows move the choice, as on every platform.
 */
export function RadioGroup<T>(props: RadioGroupProps<T>): JSX.Element {
  const nodes: Node[] = [];
  const enabled = () => props.options.map((o, i) => [o, i] as const).filter(([o]) => !o.disabled);
  const move = (by: number) => {
    const list = enabled();
    if (!list.length) return;
    const at = list.findIndex(([o]) => o.value === props.value);
    const [o, i] = list[(at + by + list.length) % list.length];
    props.onChange?.(o.value);
    nodes[i]?.focus();
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown") return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(-1);
    else return;
    e.stopPropagation?.();
  };
  // The chosen option is the one Tab reaches; with none chosen, the first enabled one.
  const tabbable = (i: number) => {
    const chosen = props.options.findIndex((o) => o.value === props.value);
    return i === (chosen >= 0 ? chosen : enabled()[0]?.[1]);
  };
  return (
    <View role="group" label={props.label} onKey={keys} style={[{ flexDirection: props.direction ?? "column", gap: props.direction === "row" ? 16 : 8 }, props.style]}>
      <For each={props.options}>
        {(o, i) => <Radio option={o} chosen={o.value === props.value} tabbable={tabbable(i())} ref={(n) => (nodes[i()] = n)} onChoose={() => props.onChange?.(o.value)} />}
      </For>
    </View>
  );
}

function Radio<T>(props: { option: RadioOption<T>; chosen: boolean; tabbable: boolean; ref: (n: Node) => void; onChoose: () => void }): JSX.Element {
  const { state, handlers } = useInteraction(() => props.option.disabled);
  return (
    <View
      {...handlers}
      ref={props.ref}
      role="radio"
      checked={props.chosen}
      disabled={props.option.disabled}
      tabIndex={props.option.disabled ? undefined : props.tabbable ? 0 : -1}
      focusable={!props.option.disabled}
      onPress={() => !props.option.disabled && props.onChoose()}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, cursor: props.option.disabled ? "notAllowed" : "pointer", opacity: props.option.disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, flexShrink: 0, justifyContent: "center", alignItems: "center", borderColor: props.chosen ? ACCENT : state().hovered ? "#6b7280" : BORDER, backgroundColor: "#ffffff" }}>
        <View transition={{ scale: 120 }} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT, scale: props.chosen ? 1 : 0 }} />
      </View>
      {label(props.option.label, { color: "#111827" })}
    </View>
  );
}

type Node = import("./ui").Node;

// ---------------------------------------------------------------------------

export interface SliderProps {
  value: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  style?: WidgetStyle<WidgetState & { value: number }>;
}

/**
 * A slider: drag the thumb or press the track; the arrows move it a step,
 * Page Up and Down a tenth, Home and End to the ends.
 */
export function Slider(props: SliderProps): JSX.Element {
  const { state, handlers } = useInteraction(() => props.disabled);
  const min = () => props.min ?? 0, max = () => Math.max(props.max ?? 100, min());
  const step = () => props.step ?? 1;
  const [track, setTrack] = createSignal({ x: 0, width: 0 });
  const THUMB = 16;
  const frac = () => (max() === min() ? 0 : (clamp(props.value) - min()) / (max() - min()));
  function clamp(v: number) {
    const s = step();
    const snapped = s > 0 ? Math.round((v - min()) / s) * s + min() : v;
    return Math.min(max(), Math.max(min(), +snapped.toFixed(10)));
  }
  const set = (v: number) => {
    const next = clamp(v);
    if (next !== props.value) props.onChange?.(next);
  };
  const at = (x: number) => {
    const t = track();
    const usable = Math.max(1, t.width - THUMB);
    set(min() + ((x - t.x - THUMB / 2) / usable) * (max() - min()));
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || props.disabled) return;
    const page = (max() - min()) / 10;
    const by: Record<string, number> = { ArrowRight: step(), ArrowUp: step(), ArrowLeft: -step(), ArrowDown: -step(), PageUp: page, PageDown: -page };
    if (e.key in by) set(props.value + by[e.key]);
    else if (e.key === "Home") set(min());
    else if (e.key === "End") set(max());
    else return;
    e.stopPropagation?.();
  };
  return (
    <View
      {...handlers}
      role="group"
      label={props.label}
      disabled={props.disabled}
      focusable={!props.disabled}
      onKey={keys}
      onLayout={(r) => setTrack({ x: r.x, width: r.width })}
      onPointerDown={(e) => {
        handlers.onPointerDown(e);
        if (e.button === 0 && !props.disabled) at(e.x);
      }}
      onPointerMove={(e) => e.buttons & 1 && !props.disabled && at(e.x)}
      style={[{ height: 20, justifyContent: "center", flexShrink: 0, cursor: props.disabled ? "notAllowed" : "pointer", opacity: props.disabled ? 0.5 : 1, borderRadius: 10 }, resolve(props.style, { ...state(), value: props.value })]}
    >
      <View style={{ height: 4, borderRadius: 2, marginLeft: THUMB / 2, marginRight: THUMB / 2, backgroundColor: MUTED }}>
        <View style={{ height: 4, borderRadius: 2, width: `${frac() * 100}%`, backgroundColor: ACCENT }} />
      </View>
      <View
        style={{
          position: "absolute", top: 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: "#ffffff", borderWidth: 1.5, borderColor: ACCENT,
          left: `${frac() * 100}%`, translateX: -frac() * THUMB, scale: state().pressed ? 1.15 : 1, boxShadow: { y: 1, blur: 3, color: "#0003" },
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface TabsProps<T extends string> {
  tabs: readonly { id: T; label: JSX.Element }[];
  value: T;
  onChange?: (id: T) => void;
  /** The chosen tab's content. */
  children?: (id: T) => JSX.Element;
  style?: StyleProp;
}

/** Tabs: a row of tabs (the arrows move between them) and the chosen one's content. */
export function Tabs<T extends string>(props: TabsProps<T>): JSX.Element {
  const nodes: Node[] = [];
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const at = props.tabs.findIndex((t) => t.id === props.value);
    const i = (at + (e.key === "ArrowRight" ? 1 : -1) + props.tabs.length) % props.tabs.length;
    props.onChange?.(props.tabs[i].id);
    nodes[i]?.focus();
    e.stopPropagation?.();
  };
  return (
    <View style={[{ gap: 12 }, props.style]}>
      <View role="tabList" onKey={keys} style={{ flexDirection: "row", gap: 4, borderBottomWidth: 1, borderColor: MUTED }}>
        <For each={props.tabs}>
          {(t, i) => <Tab chosen={t.id === props.value} ref={(n) => (nodes[i()] = n)} onPress={() => props.onChange?.(t.id)}>{t.label}</Tab>}
        </For>
      </View>
      {props.children?.(props.value)}
    </View>
  );
}

function Tab(props: { chosen: boolean; ref: (n: Node) => void; onPress: () => void; children: JSX.Element }): JSX.Element {
  const { state, handlers } = useInteraction(() => false);
  return (
    <View
      {...handlers}
      ref={props.ref}
      role="tab"
      selected={props.chosen}
      tabIndex={props.chosen ? 0 : -1}
      onPress={props.onPress}
      style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, cursor: "pointer", borderRadius: 6, backgroundColor: state().hovered && !props.chosen ? "#f3f4f6" : "transparent" }}
    >
      {label(props.children, { color: props.chosen ? ACCENT : "#4b5563", fontWeight: props.chosen ? 600 : 400 })}
      <View style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, borderRadius: 1, backgroundColor: props.chosen ? ACCENT : "transparent" }} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface DialogProps {
  open: boolean;
  /** Escape, or a press on the backdrop. */
  onClose?: () => void;
  title?: string;
  children?: JSX.Element;
  style?: StyleProp;
}

/**
 * A dialog over the window: Tab stays inside it, Escape and a press on the
 * backdrop close it, and the focus goes back where it was when it closes.
 */
export function Dialog(props: DialogProps): JSX.Element {
  return (
    <Show when={props.open}>
      <DialogBody {...props} />
    </Show>
  );
}

function DialogBody(props: DialogProps): JSX.Element {
  onKey((e) => {
    if (e.type === "keyDown" && e.key === "Escape") props.onClose?.();
  });
  return (
    <View
      onPress={() => props.onClose?.()}
      style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: "#0006", alignItems: "center", justifyContent: "center" }}
    >
      <View
        focusScope
        role="dialog"
        label={props.title}
        onPress={(e) => e.stopPropagation()}
        style={[{ minWidth: 280, maxWidth: "90%", padding: 20, gap: 12, borderRadius: 12, backgroundColor: "#ffffff", boxShadow: { y: 10, blur: 30, color: "#0004" } }, props.style]}
      >
        <Show when={props.title}>
          <Text style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>{props.title}</Text>
        </Show>
        {props.children}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface TooltipProps {
  text: string;
  /** Before it shows, in ms (default 500). */
  delay?: number;
  /** "below" (default) or "above" its anchor. */
  side?: "below" | "above";
  children: JSX.Element;
}

/** A tooltip: shows after the pointer rests on its children, hides when it leaves. */
export function Tooltip(props: TooltipProps): JSX.Element {
  const [shown, setShown] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(stop);
  return (
    <View
      onHover={(h) => {
        stop();
        if (h) timer = setTimeout(() => setShown(true), props.delay ?? 500);
        else setShown(false);
      }}
      onPointerDown={() => (stop(), setShown(false))}
      style={{ alignSelf: "start" }}
    >
      {props.children}
      <Show when={shown()}>
        <View
          role="status"
          style={{ pointerEvents: "none", position: "absolute", left: 0, ...(props.side === "above" ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }), zIndex: 900, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: "#111827" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 12, whiteSpace: "nowrap" }}>{props.text}</Text>
        </View>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SplitterProps {
  /** "row" (side by side, the default) or "column" (one above the other). */
  direction?: "row" | "column";
  /** The first pane's size (px), and its limits. */
  size: number;
  onResize?: (size: number) => void;
  min?: number;
  max?: number;
  /** The two panes. */
  children: [JSX.Element, JSX.Element];
  style?: StyleProp;
}

/** Two panes and a handle between them to drag (or move with the arrows when focused). */
export function Splitter(props: SplitterProps): JSX.Element {
  const row = () => (props.direction ?? "row") === "row";
  const limit = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? 0, v));
  let from: { at: number; size: number } | null = null;
  const { state, handlers } = useInteraction(() => false);
  return (
    <View style={[{ flexDirection: row() ? "row" : "column", flexGrow: 1, minHeight: 0, minWidth: 0 }, props.style]}>
      <View style={{ [row() ? "width" : "height"]: props.size, flexShrink: 0, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{props.children[0]}</View>
      <View
        {...handlers}
        role="none"
        focusable
        onKey={(e) => {
          if (e.type !== "keyDown") return;
          const by = { ArrowRight: 10, ArrowDown: 10, ArrowLeft: -10, ArrowUp: -10 }[e.key];
          if (by === undefined) return;
          props.onResize?.(limit(props.size + by));
          e.stopPropagation?.();
        }}
        onPointerDown={(e) => {
          handlers.onPointerDown(e);
          from = { at: row() ? e.x : e.y, size: props.size };
        }}
        onPointerMove={(e) => {
          if (!from || !(e.buttons & 1)) return;
          props.onResize?.(limit(from.size + (row() ? e.x : e.y) - from.at));
        }}
        onPointerUp={() => (from = null)}
        style={{ [row() ? "width" : "height"]: 6, flexShrink: 0, cursor: row() ? "colResize" : "rowResize", backgroundColor: state().pressed || state().hovered ? "#bfdbfe" : MUTED, focusRingOffset: 0 }}
      />
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{props.children[1]}</View>
    </View>
  );
}
