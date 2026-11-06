// More base components, built like those in widgets.tsx (accessible, keyboard-driven, themed, a `style` or a
// function of state, and a `testId` for tests and tools): Badge, Avatar, Kbd, ShortcutRecorder,
// SegmentedControl, Collapsible, Accordion, Popover, HoverCard, TreeView, RollingNumber and SortableList.
import { For, Image, Index, List, Show, Text, View, onKey, useWindowSize } from "./solid/components";
import { createMemo, createSignal, onCleanup } from "./solid/solid";
import type { JSX, ListHandle, StyleProp } from "./jsx-runtime";
import { theme } from "./widget-theme";
import { label, resolve, useInteraction, type WidgetState, type WidgetStyle } from "./widgets";
import type { KeyEvent, Node, Rect } from "./ui";

const isMac = process.platform === "darwin";

// ---------------------------------------------------------------------------

export interface BadgeProps {
  /** "neutral" (default), "accent", "success", "warning" or "danger". */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  children?: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

const TONES = {
  neutral: { bg: () => theme.controlHover, fg: () => theme.dimText },
  accent: { bg: () => theme.accent, fg: () => theme.accentText },
  success: { bg: () => "#16a34a", fg: () => "#ffffff" },
  warning: { bg: () => "#f59e0b", fg: () => "#1f1300" },
  danger: { bg: () => "#dc2626", fg: () => "#ffffff" },
};

/** A small label for a count or a state ("3", "New", "Beta"). */
export function Badge(props: BadgeProps): JSX.Element {
  const tone = () => TONES[props.tone ?? "neutral"];
  return (
    <View testId={props.testId} role="status" style={[{ flexShrink: 0, minWidth: 20, height: 20, paddingLeft: 7, paddingRight: 7, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tone().bg() }, props.style]}>
      {label(props.children, () => ({ color: tone().fg(), fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }))}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface AvatarProps {
  /** Its initials come from the name; its colour too, so a person keeps theirs. */
  name: string;
  /** A picture instead of the initials (a path, or the file's bytes). */
  src?: string | Uint8Array;
  /** Diameter in px (default 32). */
  size?: number;
  style?: StyleProp;
  testId?: string;
}

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#16a34a", "#0891b2", "#4f46e5"];

/** A person's picture, or their initials on a colour of their own. */
export function Avatar(props: AvatarProps): JSX.Element {
  const size = () => props.size ?? 32;
  const initials = () => props.name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? "").join("");
  const color = () => AVATAR_COLORS[[...props.name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % AVATAR_COLORS.length];
  return (
    <View testId={props.testId} role="image" label={props.name} style={[{ width: size(), height: size(), borderRadius: size() / 2, flexShrink: 0, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: color() }, props.style]}>
      <Show when={props.src} fallback={<Text style={{ color: "#ffffff", fontSize: Math.round(size() * 0.4), fontWeight: 600 }}>{initials()}</Text>}>
        <Image src={props.src!} style={{ width: size(), height: size(), objectFit: "cover" }} />
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

/** "Mod+Shift+K" as the platform shows it: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. `Mod` is ⌘ or Ctrl. */
export function formatShortcut(shortcut: string): string[] {
  const names: Record<string, [string, string]> = {
    mod: ["⌘", "Ctrl"], cmd: ["⌘", "Win"], meta: ["⌘", "Win"], ctrl: ["⌃", "Ctrl"], control: ["⌃", "Ctrl"], shift: ["⇧", "Shift"], alt: ["⌥", "Alt"], option: ["⌥", "Alt"],
    enter: ["↩", "Enter"], escape: ["⎋", "Esc"], backspace: ["⌫", "Backspace"], delete: ["⌦", "Del"], tab: ["⇥", "Tab"], space: ["Space", "Space"],
    arrowup: ["↑", "↑"], arrowdown: ["↓", "↓"], arrowleft: ["←", "←"], arrowright: ["→", "→"],
  };
  return shortcut.split("+").filter(Boolean).map((k) => names[k.toLowerCase()]?.[isMac ? 0 : 1] ?? (k.length === 1 ? k.toUpperCase() : k));
}

export interface KbdProps {
  /** A shortcut like "Mod+Shift+K" (Mod is ⌘ on macOS, Ctrl elsewhere), shown as keycaps. */
  keys: string;
  style?: StyleProp;
  testId?: string;
}

/** A keyboard shortcut as keycaps, the way the platform writes it. */
export function Kbd(props: KbdProps): JSX.Element {
  return (
    <View testId={props.testId} label={formatShortcut(props.keys).join(isMac ? "" : "+")} style={[{ flexDirection: "row", gap: 3, flexShrink: 0 }, props.style]}>
      <For each={formatShortcut(props.keys)}>
        {(k) => (
          <View accessHidden style={{ minWidth: 20, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderBottomWidth: 2, borderColor: theme.divider, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 11, color: theme.dimText, fontWeight: 500 }}>{k}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

/** A key event as a shortcut string ("Mod+Shift+K"), or null for a modifier alone. */
export function shortcutOf(e: Pick<KeyEvent, "key" | "shift" | "ctrl" | "alt" | "meta">): string | null {
  if (["Shift", "Control", "Alt", "Meta", "Super", "CapsLock", "Fn"].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.meta : e.ctrl) parts.push("Mod");
  if (isMac && e.ctrl) parts.push("Ctrl");
  if (!isMac && e.meta) parts.push("Meta");
  if (e.alt) parts.push("Alt");
  if (e.shift) parts.push("Shift");
  parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

export interface ShortcutRecorderProps {
  /** The shortcut ("Mod+Shift+K"), or null for none. */
  value: string | null;
  onChange?: (shortcut: string | null) => void;
  placeholder?: string;
  label?: string;
  style?: WidgetStyle<WidgetState & { recording: boolean }>;
  testId?: string;
}

/**
 * A field that records a keyboard shortcut: press it (or focus it and press Enter), then press the keys. Escape
 * cancels, Backspace clears. A shortcut needs a key besides the modifiers, and a modifier unless it's an F key.
 */
export function ShortcutRecorder(props: ShortcutRecorderProps): JSX.Element {
  const { state, handlers } = useInteraction(() => false);
  const [recording, setRecording] = createSignal(false);
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || !recording()) return;
    e.stopPropagation?.();
    if (e.key === "Escape" && !e.shift && !e.ctrl && !e.alt && !e.meta) return setRecording(false);
    if ((e.key === "Backspace" || e.key === "Delete") && !e.shift && !e.ctrl && !e.alt && !e.meta) {
      setRecording(false);
      return props.onChange?.(null);
    }
    const s = shortcutOf(e);
    if (!s) return;
    const fKey = /^F\d+$/.test(e.key);
    if (!fKey && !e.ctrl && !e.alt && !e.meta) return; // a plain letter isn't a shortcut
    setRecording(false);
    props.onChange?.(s);
  };
  return (
    <View
      {...handlers}
      testId={props.testId}
      role="button"
      label={props.label ?? (props.value ? `Shortcut ${formatShortcut(props.value).join(" ")}` : "Record a shortcut")}
      focusable
      onKey={keys}
      onBlur={() => (handlers.onBlur(), setRecording(false))}
      onPress={() => setRecording(!recording())}
      style={[
        { minWidth: 140, height: 32, paddingLeft: 8, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, borderWidth: 1, cursor: "pointer", alignSelf: "start",
          borderColor: recording() ? theme.accent : state().hovered ? theme.borderHover : theme.border, backgroundColor: theme.control },
        resolve(props.style, { ...state(), recording: recording() }),
      ]}
    >
      <Show when={!recording() && props.value} fallback={<Text style={{ color: recording() ? theme.accent : theme.placeholder }}>{recording() ? "Press keys…" : props.placeholder ?? "Record shortcut"}</Text>}>
        <Kbd keys={props.value!} />
      </Show>
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

// ---------------------------------------------------------------------------

/** A chevron, pointing right; turned 90° when open. */
const CHEVRON = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

function Chevron(props: { open: boolean; size?: number }): JSX.Element {
  const size = props.size ?? 14;
  return <Image src={CHEVRON} transition={{ rotate: { duration: 150, easing: "ease-out" } }} style={{ width: size, height: size, flexShrink: 0, color: theme.dimText, rotate: props.open ? 90 : 0 }} />;
}

export interface CollapsibleProps {
  title: JSX.Element;
  open: boolean;
  onToggle?: (open: boolean) => void;
  children?: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

/** A section that opens and closes under its title (a press, Enter or Space on the title). */
export function Collapsible(props: CollapsibleProps): JSX.Element {
  const { state, handlers } = useInteraction(() => false);
  return (
    <View testId={props.testId} style={[{ gap: 4 }, props.style]}>
      <View
        {...handlers}
        role="button"
        expanded={props.open}
        focusable
        onPress={() => props.onToggle?.(!props.open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingLeft: 6, paddingRight: 8, borderRadius: 6, cursor: "pointer", backgroundColor: state().hovered ? theme.controlHover : "transparent" }}
      >
        <Chevron open={props.open} />
        {label(props.title, () => ({ color: theme.text, fontWeight: 600 }))}
      </View>
      <Show when={props.open}>
        <View role="group" enter={{ from: { opacity: 0, translateY: -6 }, duration: 160 }} style={{ paddingLeft: 26, paddingRight: 8, paddingBottom: 6, gap: 6 }}>
          {props.children}
        </View>
      </Show>
    </View>
  );
}

export interface AccordionItem {
  id: string;
  title: JSX.Element;
  content: () => JSX.Element;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
  /** The open items' ids. */
  open: readonly string[];
  onChange?: (open: string[]) => void;
  /** More than one open at a time (default: opening one closes the others). */
  multiple?: boolean;
  style?: StyleProp;
  testId?: string;
}

/** Collapsible sections, one under another, divided by rules; by default one is open at a time. */
export function Accordion(props: AccordionProps): JSX.Element {
  const toggle = (id: string, open: boolean) => {
    const rest = props.multiple ? props.open.filter((x) => x !== id) : [];
    props.onChange?.(open ? [...rest, id] : rest);
  };
  return (
    <View testId={props.testId} style={[{ borderTopWidth: 1, borderColor: theme.divider }, props.style]}>
      <For each={props.items}>
        {(item) => (
          <View testId={props.testId ? `${props.testId}-${item.id}` : undefined} style={{ borderBottomWidth: 1, borderColor: theme.divider, paddingTop: 2, paddingBottom: 2 }}>
            <Collapsible title={item.title} open={props.open.includes(item.id)} onToggle={(o) => toggle(item.id, o)}>
              {item.content()}
            </Collapsible>
          </View>
        )}
      </For>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface PopoverProps {
  open: boolean;
  /** Escape, or a press outside it. */
  onClose?: () => void;
  /** What it shows. */
  content: () => JSX.Element;
  /** Where, next to its anchor: "below" (default), "above", "right" or "left"; aligned to the anchor's start. */
  side?: "below" | "above" | "right" | "left";
  /** The anchor. */
  children: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

const SIDES = {
  below: { left: 0, top: "100%", marginTop: 6 },
  above: { left: 0, bottom: "100%", marginBottom: 6 },
  right: { left: "100%", top: 0, marginLeft: 6 },
  left: { right: "100%", top: 0, marginRight: 6 },
} as const;

type Side = "below" | "above" | "right" | "left";
const OPPOSITE: Record<Side, Side> = { below: "above", above: "below", right: "left", left: "right" };

/** The side a panel goes on: the one asked for, or the opposite when it doesn't fit there and does there. */
function useSide(asked: () => Side | undefined) {
  const win = useWindowSize();
  const [anchor, setAnchor] = createSignal<Rect | null>(null);
  const [panel, setPanel] = createSignal<Rect | null>(null);
  const side = (): Side => {
    const want = asked() ?? "below", a = anchor(), p = panel(), w = win();
    if (!a || !p) return want;
    const room: Record<Side, number> = { below: w.height - (a.y + a.height), above: a.y, right: w.width - (a.x + a.width), left: a.x };
    const need = want === "below" || want === "above" ? p.height + 6 : p.width + 6;
    return room[want] < need && room[OPPOSITE[want]] >= need ? OPPOSITE[want] : want;
  };
  return { side, onAnchor: (r: Rect) => setAnchor(r), onPanel: (r: Rect) => setPanel(r) };
}

/**
 * Content in a floating panel next to its anchor (on the other side when there's no room): Tab stays inside,
 * Escape and a press outside close it.
 */
export function Popover(props: PopoverProps): JSX.Element {
  const win = useWindowSize();
  const { side, onAnchor, onPanel } = useSide(() => props.side);
  return (
    <View onLayout={onAnchor} style={{ alignSelf: "start" }}>
      {props.children}
      <Show when={props.open}>
        <PopoverKeys onClose={props.onClose} />
        <View onPress={() => props.onClose?.()} style={{ position: "fixed", left: 0, top: 0, width: win().width, height: win().height, zIndex: 899 }} />
        <View
          testId={props.testId}
          focusScope
          role="dialog"
          onPress={(e) => e.stopPropagation()}
          onLayout={onPanel}
          enter={{ from: { opacity: 0, scale: 0.97 }, duration: 120 }}
          style={[{ position: "absolute", ...SIDES[side()], zIndex: 900, minWidth: 200, padding: 12, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 8, blur: 24, color: "#0003" } }, props.style]}
        >
          {props.content()}
        </View>
      </Show>
    </View>
  );
}

function PopoverKeys(props: { onClose?: () => void }): JSX.Element {
  onKey((e) => {
    if (e.type === "keyDown" && e.key === "Escape") props.onClose?.();
  });
  return null;
}

export interface HoverCardProps {
  /** What it shows while the pointer rests on its anchor (or on the card). */
  content: () => JSX.Element;
  /** Before it opens, and before it closes after the pointer leaves, in ms (default 400 and 150). */
  openDelay?: number;
  closeDelay?: number;
  side?: "below" | "above" | "right" | "left";
  children: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

/** A card of detail that opens while the pointer rests on its anchor, and stays while the pointer is on it. */
export function HoverCard(props: HoverCardProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (to: boolean, ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => setOpen(to), ms);
  };
  onCleanup(() => clearTimeout(timer));
  const hover = (h: boolean) => (h ? later(true, props.openDelay ?? 400) : later(false, props.closeDelay ?? 150));
  const { side, onAnchor, onPanel } = useSide(() => props.side);
  return (
    <View onHover={hover} onLayout={onAnchor} style={{ alignSelf: "start" }}>
      {props.children}
      <Show when={open()}>
        <View
          testId={props.testId}
          role="group"
          onHover={(h) => (h ? clearTimeout(timer) : hover(false))}
          onLayout={onPanel}
          enter={{ from: { opacity: 0, translateY: 4 }, duration: 120 }}
          style={[{ position: "absolute", ...SIDES[side()], zIndex: 900, minWidth: 220, padding: 12, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 8, blur: 24, color: "#0003" } }, props.style]}
        >
          {props.content()}
        </View>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface TreeItem {
  id: string;
  label: string;
  children?: readonly TreeItem[];
  /** Before the label (an Image, say). */
  icon?: () => JSX.Element;
}

export interface TreeViewHandle {
  /** Opens its ancestors, selects it and scrolls to it. */
  reveal(id: string): void;
  /** The tree takes the keyboard focus. */
  focus(): void;
}

export interface TreeViewProps {
  items: readonly TreeItem[];
  /** The open items (controlled); without it the tree keeps its own, starting from `defaultExpanded`. */
  expanded?: ReadonlySet<string>;
  defaultExpanded?: Iterable<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  selected?: string | null;
  onSelect?: (id: string, item: TreeItem) => void;
  /** Enter, or a double press, on an item. */
  onOpen?: (id: string, item: TreeItem) => void;
  /** Row height in px (default 26). */
  rowHeight?: number;
  label?: string;
  style?: StyleProp;
  testId?: string;
  ref?: (handle: TreeViewHandle) => void;
}

interface Row {
  item: TreeItem;
  depth: number;
  parent: string | null;
}

/**
 * A tree of items that open and close (a file tree, an outline), virtualized: only the rows that show exist.
 * The arrows move (Right opens or goes in, Left closes or goes out), Home and End jump, Enter opens, and typing
 * jumps to the next item starting with what was typed. Rows get testIds `<testId>-<item id>`.
 */
export function TreeView(props: TreeViewProps): JSX.Element {
  const [own, setOwn] = createSignal<Set<string>>(new Set(props.defaultExpanded ?? []));
  const expanded = () => props.expanded ?? own();
  const setExpanded = (next: Set<string>) => {
    if (!props.expanded) setOwn(next);
    props.onExpandedChange?.(next);
  };
  const [own_sel, setOwnSel] = createSignal<string | null>(null);
  const selected = () => (props.selected !== undefined ? props.selected : own_sel());
  const rows = createMemo(() => {
    const out: Row[] = [];
    const open = expanded();
    const walk = (items: readonly TreeItem[], depth: number, parent: string | null) => {
      for (const item of items) {
        out.push({ item, depth, parent });
        if (item.children?.length && open.has(item.id)) walk(item.children, depth + 1, item.id);
      }
    };
    walk(props.items, 0, null);
    return out;
  });
  const h = () => props.rowHeight ?? 26;
  let list: ListHandle | undefined;
  let box: Node | undefined;
  const select = (i: number) => {
    const r = rows()[i];
    if (!r) return;
    setOwnSel(r.item.id);
    props.onSelect?.(r.item.id, r.item);
    list?.scrollToIndex(i);
  };
  const toggle = (id: string, open?: boolean) => {
    const next = new Set(expanded());
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };
  let typed = "", typedAt = 0;
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || e.ctrl || e.meta || e.alt) return;
    const all = rows();
    const at = all.findIndex((r) => r.item.id === selected());
    const row = all[at];
    switch (e.key) {
      case "ArrowDown": select(Math.min(all.length - 1, at + 1)); break;
      case "ArrowUp": select(Math.max(0, at - 1)); break;
      case "Home": select(0); break;
      case "End": select(all.length - 1); break;
      case "ArrowRight":
        if (!row?.item.children?.length) break;
        if (!expanded().has(row.item.id)) toggle(row.item.id, true);
        else select(at + 1);
        break;
      case "ArrowLeft":
        if (row && row.item.children?.length && expanded().has(row.item.id)) toggle(row.item.id, false);
        else if (row?.parent) select(all.findIndex((r) => r.item.id === row.parent));
        break;
      case "Enter":
        if (row) props.onOpen?.(row.item.id, row.item);
        break;
      default: {
        if ([...e.key].length !== 1 || e.key === " ") return;
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        // From the next row on (the same one again only when continuing a word), wrapping around.
        const start = typed.length > 1 ? Math.max(at, 0) : at + 1;
        for (let k = 0; k < all.length; k++) {
          const i = (start + k) % all.length;
          if (all[i].item.label.toLowerCase().startsWith(typed)) {
            select(i);
            break;
          }
        }
      }
    }
    e.stopPropagation?.();
  };
  props.ref?.({
    reveal(id: string) {
      const path: string[] = [];
      const find = (items: readonly TreeItem[], trail: string[]): boolean => {
        for (const it of items) {
          if (it.id === id) return path.push(...trail), true;
          if (it.children && find(it.children, [...trail, it.id])) return true;
        }
        return false;
      };
      if (!find(props.items, [])) return;
      const next = new Set(expanded());
      for (const p of path) next.add(p);
      setExpanded(next);
      select(rows().findIndex((r) => r.item.id === id));
    },
    focus: () => box?.focus(),
  });
  return (
    <View
      ref={(n) => (box = n)}
      testId={props.testId}
      role="tree"
      label={props.label}
      focusable
      onKey={keys}
      style={[{ minHeight: 0, flexGrow: 1, borderRadius: 8 }, props.style]}
    >
      <List each={rows()} itemHeight={h()} ref={(l) => (list = l)} style={{ flexGrow: 1, minHeight: 0 }}>
        {(row, i) => {
          const r = row();
          const open = () => expanded().has(row().item.id);
          const chosen = () => selected() === row().item.id;
          return (
            <View
              testId={props.testId ? `${props.testId}-${r.item.id}` : undefined}
              role="treeItem"
              selected={chosen()}
              expanded={row().item.children?.length ? open() : undefined}
              onPress={() => {
                select(i);
                box?.focus();
              }}
              onDoubleClick={() => props.onOpen?.(row().item.id, row().item)}
              style={{ height: h(), flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6 + row().depth * 16, paddingRight: 8, borderRadius: 6, cursor: "pointer", backgroundColor: chosen() ? theme.selected : "transparent" }}
            >
              <Show when={row().item.children?.length} fallback={<View style={{ width: 14, flexShrink: 0 }} />}>
                <View
                  role="none"
                  onPress={(e) => {
                    e.stopPropagation();
                    toggle(row().item.id);
                  }}
                  style={{ width: 14, height: 14, flexShrink: 0 }}
                >
                  <Chevron open={open()} />
                </View>
              </Show>
              {row().item.icon?.()}
              <Text style={{ color: theme.text, whiteSpace: "nowrap", flexShrink: 1, minWidth: 0, fontWeight: chosen() ? 600 : 400, maxLines: 1 }}>{row().item.label}</Text>
            </View>
          );
        }}
      </List>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface RollingNumberProps {
  /** What it shows; digits roll when it changes, other characters swap. */
  value: number | string;
  /** Font size (default 24); the line is 1.25 × that. */
  size?: number;
  color?: string;
  fontWeight?: number;
  style?: StyleProp;
  testId?: string;
}

const DIGITS = "0123456789";

/**
 * A number whose digits roll to their new values, like an odometer: each digit is a column of 0–9 sliding
 * under a clip on a spring (the core runs it). Digits keep their place from the right, so 99 → 100 rolls the
 * last two and adds a 1. Screen readers hear the value.
 */
export function RollingNumber(props: RollingNumberProps): JSX.Element {
  const size = () => props.size ?? 24;
  const line = () => Math.round(size() * 1.25);
  const chars = () => [...String(props.value)];
  // From the right (laid out right to left, by position): a digit keeps its column, and rolls, as the number grows.
  const fromRight = () => chars().reverse();
  const text = (): StyleProp => ({ fontSize: size(), lineHeight: line() / size(), height: line(), color: props.color ?? theme.text, fontWeight: props.fontWeight ?? 600, textAlign: "center" });
  return (
    <View testId={props.testId} role="status" label={String(props.value)} style={[{ flexDirection: "rowReverse", alignSelf: "start", height: line(), overflow: "hidden" }, props.style]}>
      <Index each={fromRight()}>
        {(c) => (
          <Show when={DIGITS.includes(c())} fallback={<Text accessHidden style={text()}>{c()}</Text>}>
            <View accessHidden style={{ height: line(), overflow: "hidden" }}>
              <View transition={{ translateY: { spring: { stiffness: 260, damping: 26 } } }} style={{ translateY: -DIGITS.indexOf(c()) * line() }}>
                {[...DIGITS].map((d) => <Text style={text()}>{d}</Text>)}
              </View>
            </View>
          </Show>
        )}
      </Index>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SortableListProps<T> {
  items: readonly T[];
  /** Stable keys, so rows keep their state as they move (default: the items themselves). */
  key?: (item: T) => string | number;
  /** Moves the item at `from` to `to`; the app reorders its array. */
  onReorder: (from: number, to: number) => void;
  /** Every row's height in px. */
  itemHeight: number;
  /** A row; `dragging` is true for the one being moved. */
  children: (item: T, index: () => number, dragging: () => boolean) => JSX.Element;
  label?: string;
  style?: StyleProp;
  testId?: string;
}

/**
 * Rows to put in order by dragging (the others slide out of the way), or with Alt+↑ and Alt+↓ on the focused
 * row. Rows get testIds `<testId>-<key>`.
 */
export function SortableList<T>(props: SortableListProps<T>): JSX.Element {
  const keyOf = (item: T) => (props.key ? props.key(item) : (item as unknown as string | number));
  const [drag, setDrag] = createSignal<{ key: string | number; grab: number; y: number } | null>(null);
  let top = 0;
  const indexOf = (k: string | number) => props.items.findIndex((it) => keyOf(it) === k);
  const move = (y: number) => {
    const d = drag();
    if (!d) return;
    setDrag({ ...d, y });
    const from = indexOf(d.key);
    const to = Math.max(0, Math.min(props.items.length - 1, Math.floor((y - top) / props.itemHeight)));
    if (from >= 0 && to !== from) props.onReorder(from, to);
  };
  return (
    <View testId={props.testId} role="list" label={props.label} onLayout={(r: Rect) => (top = r.y)} style={[{ minHeight: props.items.length * props.itemHeight }, props.style]}>
      <For each={props.items}>
        {(item) => {
          const k = keyOf(item);
          const index = () => indexOf(k);
          const dragging = () => drag()?.key === k;
          return (
            <View
              testId={props.testId ? `${props.testId}-${k}` : undefined}
              role="listItem"
              focusable
              transition={dragging() ? {} : { layout: { spring: { stiffness: 500, damping: 40 } } }}
              onPointerDown={(e) => e.button === 0 && setDrag({ key: k, grab: e.y - (top + index() * props.itemHeight), y: e.y })}
              onPointerMove={(e) => (e.buttons & 1 ? move(e.y) : drag() && setDrag(null))}
              onPointerUp={() => setDrag(null)}
              onKey={(e) => {
                if (e.type !== "keyDown" || !e.alt || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                const i = index(), j = i + (e.key === "ArrowUp" ? -1 : 1);
                if (j >= 0 && j < props.items.length) props.onReorder(i, j);
                e.stopPropagation?.();
              }}
              style={{
                height: props.itemHeight, cursor: dragging() ? "grabbing" : "grab", zIndex: dragging() ? 10 : 0,
                translateY: dragging() ? drag()!.y - drag()!.grab - (top + index() * props.itemHeight) : 0,
                boxShadow: dragging() ? { y: 6, blur: 18, color: "#0003" } : undefined,
              }}
            >
              {props.children(item, index, dragging)}
            </View>
          );
        }}
      </For>
    </View>
  );
}

