// Arranging content: Splitter, Table, Collapsible, Accordion and SortableList.
import { For, List, Show, Text, View } from "../solid/components";
import { createSignal } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label, useInteraction, Chevron } from "./shared";
import type { Rect } from "../ui";

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
