// Choosing where to go or what to do: Tabs, Select, Menu, Combobox and TreeView.
import { For, Input, List, Show, Text, View, useWindowSize } from "../solid/components";
import { createMemo, createSignal } from "../solid/solid";
import type { JSX, ListHandle, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label, resolve, useInteraction, Chevron, type WidgetStyle } from "./shared";
import type { KeyEvent, Node } from "../ui";

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
