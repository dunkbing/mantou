// Base components (dunkbing/mantou#22): Button, Checkbox, Toggle (a switch), RadioGroup,
// Slider, Tabs, Dialog, Tooltip, Splitter, Select, Combobox, Menu, Table, Toast, Progress and Spinner (more in
// widgets-more.tsx), built on the primitives. Each
// is accessible (a role, focus, the keyboard) and takes a `style`, either a
// style or a function of the component's state (hovered, pressed, focused,
// and its own: checked, selected…), laid over a plain default look. Keys follow
// the platforms': Space and Enter press, arrows move in groups.
import { Image, Input, List, Show, Text, View, onKey, useWindowSize } from "./solid/components";
import { For } from "./solid/components";
import { createSignal, onCleanup, onMount } from "./solid/solid";
import type { JSX, StyleProp } from "./jsx-runtime";
import { theme } from "./widget-theme";
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
    const bg = v === "primary" ? (s.pressed ? theme.accentPressed : s.hovered ? theme.accentHover : theme.accent) : s.pressed ? theme.controlPressed : s.hovered ? theme.controlHover : "transparent";
    return {
      height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
      backgroundColor: bg, borderWidth: v === "secondary" ? 1 : 0, borderColor: theme.border,
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
      {label(props.children, () => ({ color: primary() ? theme.accentText : theme.text, fontWeight: 500 }))}
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
        style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, flexShrink: 0, justifyContent: "center", alignItems: "center", borderColor: props.checked ? theme.accent : state().hovered ? theme.borderHover : theme.border, backgroundColor: props.checked ? theme.accent : theme.control }}
      >
        <Show when={props.checked}>
          <Image src={CHECK} style={{ width: 14, height: 14, color: theme.accentText }} />
        </Show>
      </View>
      {label(props.children, () => ({ color: theme.text }))}
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
      <View transition={{ backgroundColor: 150 }} style={{ width: 36, height: 20, borderRadius: 10, flexShrink: 0, padding: 2, backgroundColor: props.checked ? theme.accent : theme.track }}>
        <View transition={{ translateX: { duration: 150, easing: "ease-out" } }} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.knob, translateX: props.checked ? 16 : 0, boxShadow: { y: 1, blur: 2, color: "#0003" } }} />
      </View>
      {label(props.children, () => ({ color: theme.text }))}
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
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, flexShrink: 0, justifyContent: "center", alignItems: "center", borderColor: props.chosen ? theme.accent : state().hovered ? theme.borderHover : theme.border, backgroundColor: "#ffffff" }}>
        <View transition={{ scale: 120 }} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent, scale: props.chosen ? 1 : 0 }} />
      </View>
      {label(props.option.label, () => ({ color: theme.text }))}
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
      <View style={{ height: 4, borderRadius: 2, marginLeft: THUMB / 2, marginRight: THUMB / 2, backgroundColor: theme.divider }}>
        <View style={{ height: 4, borderRadius: 2, width: `${frac() * 100}%`, backgroundColor: theme.accent }} />
      </View>
      <View
        style={{
          position: "absolute", top: 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: theme.knob, borderWidth: 1.5, borderColor: theme.accent,
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
      <View role="tabList" onKey={keys} style={{ flexDirection: "row", gap: 4, borderBottomWidth: 1, borderColor: theme.divider }}>
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
      style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, cursor: "pointer", borderRadius: 6, backgroundColor: state().hovered && !props.chosen ? theme.controlHover : "transparent" }}
    >
      {label(props.children, () => ({ color: props.chosen ? theme.accent : theme.dimText, fontWeight: props.chosen ? 600 : 400 }))}
      <View style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, borderRadius: 1, backgroundColor: props.chosen ? theme.accent : "transparent" }} />
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
        style={[{ minWidth: 280, maxWidth: "90%", padding: 20, gap: 12, borderRadius: 12, backgroundColor: theme.surface, boxShadow: { y: 10, blur: 30, color: "#0004" } }, props.style]}
      >
        <Show when={props.title}>
          <Text style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>{props.title}</Text>
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
          style={{ pointerEvents: "none", position: "absolute", left: 0, ...(props.side === "above" ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }), zIndex: 900, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: theme.inverse }}
        >
          <Text style={{ color: theme.inverseText, fontSize: 12, whiteSpace: "nowrap" }}>{props.text}</Text>
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
        style={{ [row() ? "width" : "height"]: 6, flexShrink: 0, cursor: row() ? "colResize" : "rowResize", backgroundColor: state().pressed || state().hovered ? theme.accentSoft : theme.divider, focusRingOffset: 0 }}
      />
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{props.children[1]}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SelectOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T> {
  value: T | undefined;
  options: readonly SelectOption<T>[];
  onChange?: (value: T) => void;
  /** What it shows while no option is chosen. */
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  style?: WidgetStyle;
}

/**
 * A dropdown: a button showing the chosen option, and a list below it. Enter, Space and the arrows open it,
 * the arrows move, Enter chooses, Escape or a press elsewhere closes. The state is the app's, like the other inputs.
 */
export function Select<T>(props: SelectProps<T>): JSX.Element {
  const win = useWindowSize();
  const { state, handlers } = useInteraction(() => props.disabled);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const chosen = () => props.options.findIndex((o) => o.value === props.value);
  const show = () => {
    if (props.disabled) return;
    setActive(chosen());
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = props.options[i];
    if (o && !o.disabled) props.onChange?.(o.value);
    setOpen(false);
  };
  const step = (by: number) => {
    const n = props.options.length;
    let i = active();
    for (let k = 0; k < n; k++) {
      i = (i + by + n) % n;
      if (!props.options[i].disabled) return setActive(i);
    }
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || props.disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (open()) step(e.key === "ArrowDown" ? 1 : -1);
      else show();
    } else if (e.key === "Escape" && open()) setOpen(false);
    else return;
    e.stopPropagation?.();
  };
  // Enter and Space press the focused trigger: that chooses the highlighted option while open.
  const press = () => (open() ? choose(active()) : show());
  return (
    <View style={{ alignSelf: "start" }}>
      <View
        {...handlers}
        role="button"
        label={props.label}
        disabled={props.disabled}
        focusable={!props.disabled}
        onKey={keys}
        onPress={press}
        style={[
          { minWidth: 160, height: 32, paddingLeft: 10, paddingRight: 10, flexDirection: "row", alignItems: "center", justifyContent: "spaceBetween", gap: 8, borderRadius: 8, borderWidth: 1, borderColor: open() ? theme.accent : theme.border, backgroundColor: theme.control, opacity: props.disabled ? 0.5 : 1, cursor: props.disabled ? "notAllowed" : "pointer" },
          resolve(props.style, state()),
        ]}
      >
        <Text style={{ color: chosen() >= 0 ? theme.text : theme.placeholder, whiteSpace: "nowrap" }}>{chosen() >= 0 ? props.options[chosen()].label : props.placeholder ?? ""}</Text>
        <Text style={{ color: theme.dimText, fontSize: 10 }}>▾</Text>
      </View>
      <Show when={open()}>
        <View onPress={() => setOpen(false)} style={{ position: "fixed", left: 0, top: 0, width: win().width, height: win().height, zIndex: 899 }} /> {/* fixed is placed by the window but sized by its parent */}
        <View
          role="menu"
          style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, minWidth: "100%", zIndex: 900, padding: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 6, blur: 20, color: "#0003" } }}
        >
          <For each={props.options}>
            {(o, i) => (
              <View
                role="menuItem"
                selected={i() === chosen()}
                disabled={o.disabled}
                onHover={(h) => h && !o.disabled && setActive(i())}
                onPress={() => choose(i())}
                style={{ height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 6, justifyContent: "center", backgroundColor: active() === i() ? theme.selected : "transparent", opacity: o.disabled ? 0.4 : 1, cursor: o.disabled ? "notAllowed" : "pointer" }}
              >
                <Text style={{ color: theme.text, fontWeight: i() === chosen() ? 600 : 400, whiteSpace: "nowrap" }}>{o.label}</Text>
              </View>
            )}
          </For>
        </View>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ToastProps {
  open: boolean;
  /** After `duration`, and for a press on it. */
  onClose?: () => void;
  /** In ms before it closes itself; 0 keeps it (default 4000). */
  duration?: number;
  children?: JSX.Element;
  style?: StyleProp;
}

/** A message at the bottom of the window that closes itself. Reopen it by setting `open` again. */
export function Toast(props: ToastProps): JSX.Element {
  return (
    <Show when={props.open}>
      <ToastBody {...props} />
    </Show>
  );
}

function ToastBody(props: ToastProps): JSX.Element {
  const ms = props.duration ?? 4000;
  if (ms > 0) {
    const timer = setTimeout(() => props.onClose?.(), ms);
    onCleanup(() => clearTimeout(timer));
  }
  return (
    <View style={{ position: "fixed", left: 0, right: 0, bottom: 24, zIndex: 1100, alignItems: "center", pointerEvents: "none" }}>
      <View
        role="status"
        onPress={() => props.onClose?.()}
        style={[{ pointerEvents: "auto", maxWidth: "90%", paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10, borderRadius: 8, backgroundColor: theme.inverse, boxShadow: { y: 4, blur: 16, color: "#0004" } }, props.style]}
      >
        {label(props.children, () => ({ color: theme.inverseText }))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ProgressProps {
  /** 0 to 1. */
  value: number;
  label?: string;
  style?: StyleProp;
}

/** A progress bar. */
export function Progress(props: ProgressProps): JSX.Element {
  const frac = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return (
    <View role="status" label={props.label ?? `${Math.round(frac() * 100)}%`} style={[{ height: 8, minWidth: 120, borderRadius: 4, backgroundColor: theme.divider, overflow: "hidden" }, props.style]}>
      <View style={{ height: "100%", width: `${frac() * 100}%`, backgroundColor: theme.accent }} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SpinnerProps {
  /** Diameter in px (default 20). */
  size?: number;
  color?: string;
  label?: string;
  style?: StyleProp;
}

/** A busy indicator: a ring of dots, fading behind the leading one, turning (the core runs the turn). */
export function Spinner(props: SpinnerProps): JSX.Element {
  const size = props.size ?? 20;
  const dot = Math.max(2, Math.round(size / 5));
  const radius = (size - dot) / 2;
  const dots = Array.from({ length: 8 }, (_, i) => i);
  return (
    <View
      role="status"
      label={props.label ?? "Loading"}
      ref={(n) => onMount(() => void n.animate("rotate", { from: 0, to: 360, duration: 900, easing: "linear", iterations: Infinity }))}
      style={[{ width: size, height: size, flexShrink: 0 }, props.style]}
    >
      {dots.map((i) => {
        const a = (i / 8) * 2 * Math.PI;
        return (
          <View
            style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, backgroundColor: props.color ?? theme.accent, opacity: 1 - (i / 8) * 0.85,
              left: size / 2 - dot / 2 + radius * Math.sin(a), top: size / 2 - dot / 2 - radius * Math.cos(a) }}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface MenuEntry {
  id: string;
  label: string;
  disabled?: boolean;
  /** A line between groups: `{ id: "-", label: "", separator: true }`. */
  separator?: boolean;
}

export interface MenuProps {
  items: readonly MenuEntry[];
  onSelect?: (id: string) => void;
  /** A name for screen readers (the trigger's content may be an icon). */
  label?: string;
  disabled?: boolean;
  /** The trigger: what you press to open the menu. */
  children: JSX.Element;
}

/**
 * A popover menu below its trigger (the children): a press, Enter, Space or ArrowDown opens it; the arrows move,
 * Enter chooses, Escape or a press elsewhere closes. For a menu at the pointer, use `showMenu` (a native one).
 */
export function Menu(props: MenuProps): JSX.Element {
  const win = useWindowSize();
  const { state, handlers } = useInteraction(() => props.disabled);
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const usable = (i: number) => !!props.items[i] && !props.items[i].disabled && !props.items[i].separator;
  const show = () => {
    if (props.disabled) return;
    setActive(props.items.findIndex((_, i) => usable(i)));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    if (usable(i)) props.onSelect?.(props.items[i].id);
  };
  const step = (by: number) => {
    const n = props.items.length;
    let i = active();
    for (let k = 0; k < n; k++) {
      i = (i + by + n) % n;
      if (usable(i)) return setActive(i);
    }
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || props.disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (open()) step(e.key === "ArrowDown" ? 1 : -1);
      else show();
    } else if (e.key === "Escape" && open()) setOpen(false);
    else return;
    e.stopPropagation?.();
  };
  return (
    <View style={{ alignSelf: "start" }}>
      <View
        {...handlers}
        role="button"
        label={props.label}
        disabled={props.disabled}
        focusable={!props.disabled}
        onKey={keys}
        onPress={() => (open() ? choose(active()) : show())}
        style={{ borderRadius: 8, opacity: props.disabled ? 0.5 : 1, cursor: props.disabled ? "notAllowed" : "pointer", backgroundColor: open() || state().hovered ? theme.controlHover : "transparent" }}
      >
        {label(props.children, () => ({ color: theme.text }))}
      </View>
      <Show when={open()}>
        <View onPress={() => setOpen(false)} style={{ position: "fixed", left: 0, top: 0, width: win().width, height: win().height, zIndex: 899 }} />
        <View
          role="menu"
          style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, minWidth: 160, zIndex: 900, padding: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 6, blur: 20, color: "#0003" } }}
        >
          <For each={props.items}>
            {(it, i) =>
              it.separator ? (
                <View role="none" style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: theme.divider }} />
              ) : (
                <View
                  role="menuItem"
                  disabled={it.disabled}
                  onHover={(h) => h && usable(i()) && setActive(i())}
                  onPress={() => choose(i())}
                  style={{ height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 6, justifyContent: "center", backgroundColor: active() === i() ? theme.selected : "transparent", opacity: it.disabled ? 0.4 : 1, cursor: it.disabled ? "notAllowed" : "pointer" }}
                >
                  <Text style={{ color: theme.text, whiteSpace: "nowrap" }}>{it.label}</Text>
                </View>
              )
            }
          </For>
        </View>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface TableColumn<T> {
  key: string;
  header: string;
  /** Fixed width in px; without it the column shares what's left. */
  width?: number;
  align?: "start" | "center" | "end";
  /** The cell: default is the row's `key` property as text. */
  render?: (row: T, index: number) => JSX.Element;
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  /** Row height in px (default 32). */
  rowHeight?: number;
  /** The column the rows are sorted by and which way (the app sorts `rows`; this draws the arrow). */
  sort?: { key: string; descending?: boolean };
  /** A header was pressed. */
  onSort?: (key: string) => void;
  onRowPress?: (row: T, index: number) => void;
  /** The row marked as chosen. */
  selected?: number;
  style?: StyleProp;
}

/** A table: a header row over virtualized rows (a `List`), so thousands of rows are cheap. */
export function Table<T>(props: TableProps<T>): JSX.Element {
  const cell = (c: TableColumn<T>): StyleProp => ({
    ...(c.width ? { width: c.width, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
    paddingLeft: 10, paddingRight: 10, justifyContent: "center", alignItems: c.align ?? "start",
  });
  return (
    <View role="list" style={[{ minHeight: 0, borderWidth: 1, borderColor: theme.divider, borderRadius: 8, overflow: "hidden" }, props.style]}>
      <View style={{ flexDirection: "row", height: props.rowHeight ?? 32, backgroundColor: theme.surfaceAlt, borderBottomWidth: 1, borderColor: theme.divider, flexShrink: 0 }}>
        <For each={props.columns}>
          {(c) => (
            <View role="button" label={`Sort by ${c.header}`} onPress={() => props.onSort?.(c.key)} style={[cell(c), { flexDirection: "row", gap: 4, cursor: props.onSort ? "pointer" : "default" }]}>
              <Text style={{ fontWeight: 600, color: theme.text, whiteSpace: "nowrap" }}>{c.header}</Text>
              <Show when={props.sort?.key === c.key}>
                <Text style={{ color: theme.dimText, fontSize: 10 }}>{props.sort?.descending ? "▼" : "▲"}</Text>
              </Show>
            </View>
          )}
        </For>
      </View>
      <List each={props.rows} itemHeight={props.rowHeight ?? 32} style={{ flexGrow: 1, minHeight: 0 }}>
        {(row, i) => (
          <View
            role="listItem"
            selected={props.selected === i}
            onPress={() => props.onRowPress?.(row(), i)}
            style={{ flexDirection: "row", height: props.rowHeight ?? 32, backgroundColor: props.selected === i ? theme.selected : i % 2 ? theme.surfaceAlt : theme.surface, cursor: props.onRowPress ? "pointer" : "default" }}
          >
            <For each={props.columns}>
              {(c) => <View style={cell(c)}>{c.render ? c.render(row(), i) : <Text style={{ color: theme.text, whiteSpace: "nowrap" }}>{String((row() as Record<string, unknown>)[c.key] ?? "")}</Text>}</View>}
            </For>
          </View>
        )}
      </List>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ComboboxProps {
  /** The text in the field (controlled). */
  value: string;
  onChange: (text: string) => void;
  /** The suggestions; those containing the text (ignoring case) are listed. */
  options: readonly string[];
  /** A suggestion was chosen (the text is already set to it). Enter in the field submits as usual when none is highlighted. */
  onSelect?: (option: string) => void;
  onSubmit?: (text: string) => void;
  placeholder?: string;
  /** At most this many suggestions are listed (default 8). */
  limit?: number;
  label?: string;
  style?: StyleProp;
}

/** A text field with suggestions below it: typing narrows them, the arrows move, Enter takes one, Escape closes. */
export function Combobox(props: ComboboxProps): JSX.Element {
  const win = useWindowSize();
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const matches = () => {
    const q = props.value.toLowerCase();
    return props.options.filter((o) => o.toLowerCase().includes(q) && o !== props.value).slice(0, props.limit ?? 8);
  };
  const list = () => open() && matches().length > 0;
  const take = (o: string) => {
    props.onChange(o);
    setOpen(false);
    setActive(-1);
    props.onSelect?.(o);
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown") return;
    const n = matches().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      if (!open()) setOpen(true);
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === "Escape" && open()) setOpen(false);
    else return;
    e.stopPropagation?.();
  };
  return (
    <View onKey={keys} style={{ alignSelf: "start" }}>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(t) => {
          props.onChange(t);
          setOpen(true);
          setActive(-1);
        }}
        onSubmit={(t) => {
          const o = matches()[active()];
          if (list() && o !== undefined) take(o);
          else {
            setOpen(false);
            props.onSubmit?.(t);
          }
        }}
        label={props.label}
        style={[{ minWidth: 200, height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.control, color: theme.text }, props.style]}
      />
      <Show when={list()}>
        <View onPress={() => setOpen(false)} style={{ position: "fixed", left: 0, top: 0, width: win().width, height: win().height, zIndex: 899 }} />
        <View role="menu" style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, minWidth: "100%", zIndex: 900, padding: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 6, blur: 20, color: "#0003" } }}>
          <For each={matches()}>
            {(o, i) => (
              <View
                role="menuItem"
                onHover={(h) => h && setActive(i())}
                onPress={() => take(o)}
                style={{ height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 6, justifyContent: "center", backgroundColor: active() === i() ? theme.selected : "transparent", cursor: "pointer" }}
              >
                <Text style={{ color: theme.text, whiteSpace: "nowrap" }}>{o}</Text>
              </View>
            )}
          </For>
        </View>
      </Show>
    </View>
  );
}
