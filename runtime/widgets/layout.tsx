// Arranging content: Splitter, Table, Collapsible, Accordion and SortableList.
import { For, List, Show, Text, View } from "../solid/components";
import { createSignal } from "../solid/solid";
import type { JSX, ListHandle, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label, useInteraction, Chevron, isMac } from "./shared";
import type { KeyEvent, Rect } from "../ui";

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
  /** Over the table's `headerStyle` and `headerTextStyle`, for this column. */
  headerStyle?: StyleProp;
  headerTextStyle?: StyleProp;
  /** Over the table's `cellStyle`, for this column's cells. */
  cellStyle?: StyleProp | ((row: T, index: number) => StyleProp);
  /** Its header sorts (default: when the table has `onSort`). */
  sortable?: boolean;
}

/** The modifier keys held during a press. `primary` is ⌘ on macOS and Ctrl elsewhere. */
export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  primary: boolean;
}

/** What a row's look can depend on. */
export interface RowState {
  selected: boolean;
  hovered: boolean;
  /** The row the keyboard is on (in a focused table). */
  active: boolean;
}

export interface TableProps<T, K = number> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  /** Row height in px (default the theme's controlHeight), and the header's (default the same). */
  rowHeight?: number;
  headerHeight?: number;
  /** The column the rows are sorted by and which way (the app sorts `rows`; this draws the arrow). */
  sort?: { key: string; descending?: boolean };
  /** A sortable header was pressed. */
  onSort?: (key: string) => void;
  /** A row was pressed, with the modifier keys held. */
  onRowPress?: (row: T, index: number, mods: Modifiers) => void;
  onRowDoubleClick?: (row: T, index: number) => void;
  /** A secondary press (or Ctrl+press on macOS) on a row, at (x, y) in the window: open a menu there. */
  onRowContextMenu?: (row: T, index: number, at: { x: number; y: number }) => void;
  /** What screen readers call a row (default: its cells' text). */
  rowLabel?: (row: T, index: number) => string;
  /** A row's identity for `selection` (default: its index). */
  rowKey?: (row: T, index: number) => K;
  /**
   * The selected rows, by key: the table selects as file lists do (a press selects one row, Shift+press a range,
   * ⌘/Ctrl+press adds or removes one; ↑ and ↓ move, with Shift to extend; ⌘/Ctrl+A selects all) and calls
   * `onSelectionChange`. The state is the app's.
   */
  selection?: ReadonlySet<K>;
  onSelectionChange?: (selection: Set<K>) => void;
  /** Rows marked as chosen, without the table selecting: an index, or a test. */
  selected?: number | ((row: T, index: number) => boolean);
  /** Every other row tinted (default true). */
  striped?: boolean;
  /** Cells' left and right padding in px (default 10). */
  cellPadding?: number;
  /** The header row, and its text. */
  headerStyle?: StyleProp;
  headerTextStyle?: StyleProp;
  /** Every row, over the default look (selected, striped, hovered). */
  rowStyle?: StyleProp | ((row: T, index: number, state: RowState) => StyleProp);
  cellStyle?: StyleProp | ((row: T, index: number) => StyleProp);
  /** The outer box (border, radius and background come from here too: `{ borderWidth: 0, borderRadius: 0 }` for a flat table). */
  style?: StyleProp;
  label?: string;
  /** Rows get testIds `<testId>-<key>`. */
  testId?: string;
}

const pick = <A extends unknown[]>(v: StyleProp | ((...a: A) => StyleProp) | undefined, ...a: A): StyleProp => (typeof v === "function" ? v(...a) : v);

/**
 * A table: a header row over virtualized rows (a `List`), so thousands of rows are cheap. Rows can be
 * selected (one, a range, several), double-clicked and opened with a context menu, and everything is
 * styled through props and the theme.
 */
export function Table<T, K = number>(props: TableProps<T, K>): JSX.Element {
  const h = () => props.rowHeight ?? theme.controlHeight;
  const pad = () => props.cellPadding ?? 10;
  const keyOf = (row: T, i: number) => (props.rowKey ? props.rowKey(row, i) : (i as unknown as K));
  const multi = () => !!props.selection && !!props.onSelectionChange;
  const isSelected = (row: T, i: number) =>
    multi() ? props.selection!.has(keyOf(row, i)) : typeof props.selected === "function" ? props.selected(row, i) : props.selected === i;
  const [active, setActive] = createSignal(-1);
  const [hovered, setHovered] = createSignal(-1);
  let anchor = -1;
  let mods: Modifiers = { shift: false, ctrl: false, alt: false, meta: false, primary: false };
  let list: ListHandle | undefined;
  const range = (a: number, b: number) => {
    const out: K[] = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(keyOf(props.rows[i], i));
    return out;
  };
  /** Selects as file lists do, for a press (or a key) on row `i` with `m` held. */
  const choose = (i: number, m: Pick<Modifiers, "shift" | "primary">) => {
    if (!multi() || i < 0 || i >= props.rows.length) return;
    const k = keyOf(props.rows[i], i);
    // A range starts from the last row pressed, or else from the first selected one.
    if (anchor < 0 || anchor >= props.rows.length) anchor = props.rows.findIndex((r, j) => props.selection!.has(keyOf(r, j)));
    let next: Set<K>;
    if (m.shift && anchor >= 0) next = new Set([...(m.primary ? props.selection! : []), ...range(anchor, i)]);
    else if (m.primary) {
      next = new Set(props.selection);
      if (!next.delete(k)) next.add(k);
      anchor = i;
    } else {
      next = new Set([k]);
      anchor = i;
    }
    setActive(i);
    props.onSelectionChange!(next);
  };
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || !multi() || !props.rows.length) return;
    const primary = isMac ? e.meta : e.ctrl;
    const at = active();
    const go = (i: number) => {
      const j = Math.max(0, Math.min(props.rows.length - 1, i));
      choose(j, { shift: e.shift, primary: false });
      list?.scrollToIndex(j);
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? 0 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(props.rows.length - 1);
    else if (primary && (e.key === "a" || e.key === "A")) props.onSelectionChange!(new Set(range(0, props.rows.length - 1)));
    else if (e.key === "Enter" && at >= 0) props.onRowDoubleClick?.(props.rows[at], at);
    else return;
    e.stopPropagation?.();
  };
  const cell = (c: TableColumn<T>): StyleProp => ({
    ...(c.width ? { width: c.width, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
    paddingLeft: pad(), paddingRight: pad(), justifyContent: "center", alignItems: c.align ?? "start",
  });
  const textOf = (row: T, c: TableColumn<T>) => String((row as Record<string, unknown>)[c.key] ?? "");
  return (
    <View
      testId={props.testId}
      role="list"
      label={props.label}
      focusable={multi()}
      onKey={keys}
      style={[{ minHeight: 0, borderWidth: 1, borderColor: theme.divider, borderRadius: theme.radius, overflow: "hidden", backgroundColor: theme.surface }, props.style]}
    >
      <View style={[{ flexDirection: "row", height: props.headerHeight ?? h(), backgroundColor: theme.surfaceAlt, borderBottomWidth: 1, borderColor: theme.divider, flexShrink: 0 }, props.headerStyle]}>
        <For each={props.columns}>
          {(c) => {
            const sorts = () => c.sortable ?? !!props.onSort;
            return (
              <View
                role={sorts() ? "button" : "none"}
                label={sorts() ? `Sort by ${c.header}` : undefined}
                onPress={() => sorts() && props.onSort?.(c.key)}
                style={[cell(c), { flexDirection: "row", gap: 4, alignItems: "center", justifyContent: c.align ?? "start", cursor: sorts() ? "pointer" : "default" }, c.headerStyle]}
              >
                <Text style={[{ fontWeight: 600, color: theme.text, whiteSpace: "nowrap" }, props.headerTextStyle, c.headerTextStyle]}>{c.header}</Text>
                <Show when={props.sort?.key === c.key}>
                  <Text style={[{ color: theme.dimText, fontSize: 10 }, props.headerTextStyle, c.headerTextStyle]}>{props.sort?.descending ? "▼" : "▲"}</Text>
                </Show>
              </View>
            );
          }}
        </For>
      </View>
      <List each={props.rows} itemHeight={h()} ref={(l) => (list = l)} style={{ flexGrow: 1, minHeight: 0 }}>
        {(row, i) => {
          const state = (): RowState => ({ selected: isSelected(row(), i), hovered: hovered() === i, active: active() === i });
          return (
            <View
              testId={props.testId ? `${props.testId}-${String(keyOf(row(), i))}` : undefined}
              role="listItem"
              selected={state().selected}
              label={props.rowLabel?.(row(), i)}
              onHover={(on) => (on ? setHovered(i) : hovered() === i && setHovered(-1))}
              onPointerDown={(e) => (mods = { shift: e.shift, ctrl: e.ctrl, alt: e.alt, meta: e.meta, primary: isMac ? e.meta : e.ctrl })}
              onPress={() => {
                const m = mods;
                mods = { shift: false, ctrl: false, alt: false, meta: false, primary: false };
                choose(i, m);
                props.onRowPress?.(row(), i, m);
              }}
              onDoubleClick={() => props.onRowDoubleClick?.(row(), i)}
              onContextMenu={(e) => props.onRowContextMenu?.(row(), i, { x: e.x, y: e.y })}
              style={[
                {
                  flexDirection: "row", height: h(),
                  backgroundColor: state().selected ? theme.selected : state().hovered && (props.onRowPress || multi()) ? theme.controlHover : (props.striped ?? true) && i % 2 ? theme.surfaceAlt : theme.surface,
                  cursor: props.onRowPress || multi() ? "pointer" : "default",
                },
                pick(props.rowStyle, row(), i, state()),
              ]}
            >
              <For each={props.columns}>
                {(c) => (
                  <View style={[cell(c), pick(props.cellStyle, row(), i), pick(c.cellStyle, row(), i)]}>
                    {c.render ? c.render(row(), i) : <Text style={{ color: theme.text, whiteSpace: "nowrap" }}>{textOf(row(), c)}</Text>}
                  </View>
                )}
              </For>
            </View>
          );
        }}
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
        style={{ flexDirection: "row", alignItems: "center", gap: 6, height: theme.controlHeight, paddingLeft: 6, paddingRight: 8, borderRadius: theme.radiusSmall, cursor: "pointer", backgroundColor: state().hovered ? theme.controlHover : "transparent" }}
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
