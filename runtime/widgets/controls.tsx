// Controls that set a value: Button, Checkbox, Toggle, RadioGroup, Slider and SegmentedControl.
import { For, Image, Show, View } from "../solid/components";
import { createSignal } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label, resolve, useInteraction, type WidgetState, type WidgetStyle } from "./shared";
import type { KeyEvent, Node, Rect } from "../ui";

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

export interface SegmentedControlProps<T> {
  options: readonly { value: T; label: JSX.Element; disabled?: boolean }[];
  value: T;
  onChange?: (value: T) => void;
  label?: string;
  style?: StyleProp;
  testId?: string;
}

/** A row of mutually exclusive choices with a thumb that slides to the chosen one; the arrows move it. */
export function SegmentedControl<T>(props: SegmentedControlProps<T>): JSX.Element {
  // Each segment's box (from its onLayout), relative to the control: the thumb slides to the chosen one's.
  const [boxes, setBoxes] = createSignal<Rect[]>([]);
  let origin = { x: 0, y: 0 };
  const nodes: Node[] = [];
  const index = () => props.options.findIndex((o) => o.value === props.value);
  const box = () => boxes()[index()];
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const by = e.key === "ArrowRight" ? 1 : -1;
    for (let k = 1, i = index(); k <= props.options.length; k++) {
      const j = (i + by * k + props.options.length * 2) % props.options.length;
      if (!props.options[j].disabled) {
        props.onChange?.(props.options[j].value);
        nodes[j]?.focus();
        break;
      }
    }
    e.stopPropagation?.();
  };
  return (
    <View
      testId={props.testId}
      role="radioGroup"
      label={props.label}
      onKey={keys}
      onLayout={(r: Rect) => (origin = r)}
      style={[{ flexDirection: "row", alignSelf: "start", padding: 2, height: 32, borderRadius: 8, backgroundColor: theme.controlHover }, props.style]}
    >
      <Show when={box()}>
        <View
          transition={{ translateX: { spring: { stiffness: 400, damping: 34 } } }}
          style={{ position: "absolute", left: 0, top: 2, bottom: 2, width: box()!.width, translateX: box()!.x, borderRadius: 6, backgroundColor: theme.surface, boxShadow: { y: 1, blur: 3, color: "#0002" } }}
        />
      </Show>
      <For each={props.options}>
        {(o, i) => (
          <View
            ref={(n) => (nodes[i()] = n)}
            role="radio"
            checked={i() === index()}
            disabled={o.disabled}
            tabIndex={i() === index() ? 0 : -1}
            onLayout={(r: Rect) => setBoxes((b) => {
              const next = [...b];
              next[i()] = { ...r, x: r.x - origin.x, y: r.y - origin.y };
              return next;
            })}
            onPress={() => !o.disabled && props.onChange?.(o.value)}
            style={{ flexShrink: 0, minWidth: 56, paddingLeft: 12, paddingRight: 12, borderRadius: 6, alignItems: "center", justifyContent: "center", cursor: o.disabled ? "notAllowed" : "pointer", opacity: o.disabled ? 0.4 : 1 }}
          >
            {label(o.label, () => ({ color: i() === index() ? theme.text : theme.dimText, fontWeight: i() === index() ? 600 : 500, whiteSpace: "nowrap" }))}
          </View>
        )}
      </For>
    </View>
  );
}
