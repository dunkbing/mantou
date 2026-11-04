// The Worker's mirror of the UI tree. Every mutation updates the mirror and
// appends an op; the batch is committed once per JS turn (design §7, §8).
// The Solid renderer (runtime/solid) drives this layer; apps can use it
// directly too.
import { KeyModifier, WindowStateFlag } from "./gen/protocol";
import { AccessFlag, AccessRole, AnimateFlag, Easing as EasingCode, EventMask, FocusScopeFlag, InputFlag, NodeKind, ScrollBlock, ScrollFlag, StyleProp, WindowFlag, type StylePropName } from "./gen/protocol";
import { OpEncoder } from "./encoder";
import type { InputCoreEvent } from "./events";
import { expandStyle, f32bits, parseColor, type Style } from "./style";
import type { Color } from "./gen/protocol";

export type { Style } from "./style";

/** Where committed batches go: the native core, or a mock in tests. */
export interface Sink {
  commit(bytes: Uint8Array): void;
  /** The node's laid-out box [x0, y0, x1, y1] in logical px, if the sink lays out. */
  rect?(id: number): [number, number, number, number] | null;
  /** An Input's selection [anchor, focus] in UTF-16 code units, if the sink edits text. */
  selection?(id: number): [number, number] | null;
  /** Sends a platform service request (JSON); the answer comes back through `Ui.dispatchService`. */
  service?(req: number, json: string): void;
  /** The id of the topmost node at logical (x, y), or 0, if the sink lays out. */
  hit?(x: number, y: number): number;
}

/** Properties the core can animate (design §9.4). */
export type AnimatableProp = "opacity" | "translateX" | "translateY" | "scale" | "backgroundColor" | "borderColor" | "color";
const ANIMATABLE: readonly AnimatableProp[] = ["opacity", "translateX", "translateY", "scale", "backgroundColor", "borderColor", "color"];
const COLOURS: readonly AnimatableProp[] = ["backgroundColor", "borderColor", "color"];

/** CSS's timing functions. */
export type Easing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
const EASINGS: Record<Easing, number> = {
  linear: EasingCode.Linear, ease: EasingCode.Ease, "ease-in": EasingCode.EaseIn, "ease-out": EasingCode.EaseOut, "ease-in-out": EasingCode.EaseInOut,
};

/** A property's transition: a duration in ms, or a duration and an easing ("ease" by default). */
export type TransitionSpec = number | { duration: number; easing?: Easing };
/** Which properties animate to their new values when the app changes them. */
export type Transitions = Partial<Record<AnimatableProp, TransitionSpec>>;

export interface AnimateOptions {
  /** Start and end values: numbers, or colours for colour properties. */
  from: number | Color;
  to: number | Color;
  /** One iteration, in ms. */
  duration: number;
  easing?: Easing;
  /** How many times (default 1; Infinity = until stopped). */
  iterations?: number;
  /** Every other iteration runs backwards. */
  alternate?: boolean;
}

/** A running ANIMATE. */
export interface Animation {
  /** Settles when it ends: it finished, `stop()` was called, another animation of its property replaced it, or its node was released. */
  readonly finished: Promise<void>;
  /** Ends it now; the property goes back to its style's value. */
  stop(): void;
}

function easingCode(e: Easing | undefined): number {
  if (e === undefined) return EasingCode.Ease;
  const c = EASINGS[e];
  if (c === undefined) throw new Error(`mantou: unknown easing "${e}" (use ${Object.keys(EASINGS).join(", ")})`);
  return c;
}

function animatable(prop: string): AnimatableProp {
  if (!ANIMATABLE.includes(prop as AnimatableProp)) throw new Error(`mantou: ${prop} can't be animated (only ${ANIMATABLE.join(", ")})`);
  return prop as AnimatableProp;
}

export type AccessRoleName = Uncapitalize<Exclude<keyof typeof AccessRole, "Auto">>;

/** What assistive technology is told about a node. */
export interface AccessInfo {
  /** Default: from the node's kind (Text a label, an Input a text field, a View with onPress a button). "none" leaves the node itself out. */
  role?: AccessRoleName;
  /** Its name; default: the text inside it. */
  label?: string;
  /** For checkbox, switch, radio and menuItem roles; "mixed" for in between. */
  checked?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
  /** Leave the node and what's inside it out. */
  hidden?: boolean;
}

/** A laid-out box, in logical px from the window's top left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A scroll view's offset, in logical px. */
export interface ScrollOffset {
  x: number;
  y: number;
}

/** Where scrollIntoView puts a node: "nearest" (the default) moves as little as it can. */
export type ScrollBlockName = "nearest" | "start" | "center" | "end";

/** The window's size in logical px, and its scale factor (device px per logical px). */
export interface WindowSize {
  width: number;
  height: number;
  scale: number;
}

export interface WheelEvent {
  target: Node;
  currentTarget: Node;
  /** Logical px; positive dy scrolls content up (towards later content). */
  dx: number;
  dy: number;
  stopPropagation(): void;
}

export interface KeyEvent {
  type: "keyDown" | "keyUp";
  /** A character ("j", "J", " ") or a named key ("ArrowDown", "Enter", "Escape"…). */
  key: string;
  repeat?: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/** A pointer going down, up or moving over a node (design §8.2). While a button is held, the node that was pressed hears everything, even outside its box. */
export interface PointerEvent {
  target: Node;
  /** The node whose handler is running. */
  currentTarget: Node;
  /** Logical px from the window's top left. */
  x: number;
  y: number;
  /** The button that changed: 0 primary, 1 middle, 2 secondary. For a move, 0. */
  button: number;
  /** The buttons held now, a bit per button (1 << button). */
  buttons: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  /** Presses in a row at one spot: 1, 2 for a double click… (down events). */
  clicks: number;
  stopPropagation(): void;
}

const isMac = process.platform === "darwin";

/** The window's state (logical px for the position: the window's outer top left on the screen). */
export interface WindowState {
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  /** The system is using its dark appearance. */
  dark: boolean;
  x: number;
  y: number;
}

/** Files dragged over the window or dropped on it. */
export interface DropEvent {
  /** The node under the pointer with a drop handler (the innermost, or the one bubbled to). */
  target: Node | null;
  currentTarget: Node | null;
  x: number;
  y: number;
  /** Absolute paths (files from the OS; empty for a drag inside the app). */
  files: string[];
  /** What a dragged view carries (its `draggable` value); undefined for files from the OS. */
  data?: unknown;
  stopPropagation(): void;
}

export interface PressEvent {
  target: Node;
  /** The node whose handler is running. */
  currentTarget: Node;
  x: number;
  y: number;
  stopPropagation(): void;
}

/** An Input's options (INPUT_OPTIONS). */
export interface InputOptions {
  multiline?: boolean;
  /** A password field: a bullet per character, no copy or cut, the IME off. */
  secure?: boolean;
  readOnly?: boolean;
  /** The characters typing and pasting may add: `"0-9."` (characters and ranges; a leading `^` means all but these). Checked in the core. */
  allow?: string;
  /** In characters; 0 = no limit. */
  maxLength?: number;
}

type InputHandlers = {
  change: ((value: string) => void)[];
  submit: ((value: string) => void)[];
  /** The caret or selection moved: UTF-16 units like the DOM's selectionStart; equal means a caret. */
  select: ((s: { start: number; end: number; anchor: number; focus: number }) => void)[];
  focus: (() => void)[];
  blur: (() => void)[];
};

/**
 * A style defined once and shared by many nodes (STYLE_DEF / STYLE_USE). It
 * isn't tied to a Ui: each Ui sends its definition the first time a node uses it.
 */
export class SharedStyle {
  constructor(readonly style: Style) {}
}

/** Defines a shared style; nodes then reference it with one op each. */
export function defineStyle(style: Style): SharedStyle {
  return new SharedStyle(style);
}

/**
 * A piece of text in the mirror tree. Inside a Text node, the node's content
 * is its leaves' text joined (sent as one TEXT op per change, at the end of
 * the turn). Elsewhere a leaf sends nothing: Solid uses empty leaves as
 * placeholders, and text outside <Text> isn't drawn.
 */
export class TextLeaf {
  parent: Node | null = null;
  constructor(private value: string) {}

  get text(): string {
    return this.value;
  }

  set text(value: string) {
    if (value === this.value) return;
    this.value = value;
    this.parent?.textChanged();
  }
}

export type Child = Node | TextLeaf;

export class Node {
  parent: Node | null = null;
  /** All children, text leaves included, in order. */
  readonly children: Child[] = [];
  released = false;
  private own = new Map<StylePropName, unknown>();
  private shared: SharedStyle | null = null;
  private pressHandlers: ((e: PressEvent) => void)[] = [];
  private wheelHandlers: ((e: WheelEvent) => void)[] = [];
  private layoutHandlers: ((rect: Rect) => void)[] = [];
  private scrollHandlers: ((offset: ScrollOffset) => void)[] = [];
  private hoverHandlers: ((hovered: boolean) => void)[] = [];
  private dropHandlers: { drop: ((e: DropEvent) => void)[]; over: ((e: DropEvent | null) => void)[] } = { drop: [], over: [] };
  private pointerHandlers: Record<"down" | "up" | "move" | "context" | "double", ((e: PointerEvent) => void)[]> = { down: [], up: [], move: [], context: [], double: [] };
  /** Whether the pointer is over this node (or a descendant), as the core last reported; only tracked while it has hover handlers. */
  hovered = false;
  private imageHandlers: { load: ((size: { width: number; height: number }) => void)[]; error: ((message: string) => void)[] } = { load: [], error: [] };
  /** The transitions last sent, by property: duration and easing code. */
  private transitions = new Map<AnimatableProp, [number, number]>();
  /** Running animations' ids. */
  private running = new Set<number>();
  /** An Image's natural size once it has loaded (logical px), or the error if it failed. */
  imageState: { width: number; height: number } | { error: string } | null = null;
  /** A scroll view's offset, as the core last reported it to scroll handlers. */
  scrollOffset: ScrollOffset = { x: 0, y: 0 };
  /** The box the core last reported to this node's layout handlers. */
  layout: Rect | null = null;
  /** The content last sent for a Text node. */
  sentText = "";
  /**
   * An Input's text: what the core last reported, or the app last set. The
   * core owns it while the user types; `rev` counts the user's edits seen.
   */
  value = "";
  rev = 0;
  private controlled: string | undefined;
  /** A value set this turn, with the rev it was derived from; sent after the options. */
  private pendingValue: { text: string; rev: number } | null = null;
  private pendingSelection: [number, number] | null = null;
  private placeholderText = "";
  private options = { flags: 0, maxLength: 0, allow: "" };
  private sentOptions = { flags: 0, maxLength: 0, allow: "" };
  private inputHandlers: InputHandlers | null = null;

  constructor(readonly ui: Ui, readonly id: number, readonly kind: number) {}

  get isText(): boolean {
    return this.kind === NodeKind.Text;
  }

  get isInput(): boolean {
    return this.kind === NodeKind.Input;
  }

  get isImage(): boolean {
    return this.kind === NodeKind.Image;
  }

  /**
   * An Image's source: a PNG, JPEG, WebP or SVG file (a path the core reads,
   * relative to the working directory) or its bytes. onImageLoad or
   * onImageError follows.
   */
  src(source: string | Uint8Array): this {
    this.alive();
    if (!this.isImage) throw new Error(`mantou: src is for <Image>, not <${this.kindName}>`);
    if (typeof source === "string") this.ui.enc.imagePath(this.id, source);
    else this.ui.enc.imageData(this.id, source);
    this.ui.schedule();
    return this;
  }

  /** An Image's source was decoded: its natural size. Returns a function that removes the handler. */
  onImageLoad(handler: (size: { width: number; height: number }) => void): () => void {
    this.imageHandlers.load.push(handler);
    return () => void this.imageHandlers.load.splice(this.imageHandlers.load.indexOf(handler) >>> 0, 1);
  }

  /** An Image's source couldn't be read or decoded. Returns a function that removes the handler. */
  onImageError(handler: (message: string) => void): () => void {
    this.imageHandlers.error.push(handler);
    return () => void this.imageHandlers.error.splice(this.imageHandlers.error.indexOf(handler) >>> 0, 1);
  }

  /** @internal */
  handleImage(result: { width: number; height: number } | { error: string }) {
    this.imageState = result;
    if ("error" in result) for (const h of [...this.imageHandlers.error]) h(result.error);
    else for (const h of [...this.imageHandlers.load]) h(result);
  }

  /** A name for messages: "View", "Text" or "Input". */
  get kindName(): string {
    return this.isText ? "Text" : this.isInput ? "Input" : this.isImage ? "Image" : "View";
  }

  private assertInput(what: string) {
    this.alive();
    if (!this.isInput) throw new Error(`mantou: ${what} is for <Input>, not <${this.kindName}>`);
  }

  /**
   * Sets an Input's text from the app. It never undoes typing the app hasn't
   * seen yet: the core keeps the user's newer edit, and reports it.
   */
  setValue(value: string): this {
    this.assertInput("setValue");
    if (value === this.value) return this;
    this.value = value;
    this.pendingValue = { text: value, rev: this.rev };
    this.ui.markPending(this);
    return this;
  }

  /**
   * Makes the Input controlled by `value` (undefined: uncontrolled). After
   * each change the user makes, change handlers run; if the controlled value
   * is then still different, the input goes back to it.
   */
  control(value: string | undefined): this {
    this.assertInput("control");
    this.controlled = value;
    if (value !== undefined) this.setValue(value);
    return this;
  }

  /** What an empty Input shows. */
  placeholder(text: string): this {
    this.assertInput("placeholder");
    if (text === this.placeholderText) return this;
    this.placeholderText = text;
    this.ui.enc.placeholder(this.id, text);
    this.ui.schedule();
    return this;
  }

  /** Changes some of an Input's options; sent once at the end of the turn. */
  setOptions(options: InputOptions): this {
    this.assertInput("setOptions");
    const o = this.options;
    const flag = (bit: number, on: boolean | undefined) => {
      if (on !== undefined) o.flags = on ? o.flags | bit : o.flags & ~bit;
    };
    flag(InputFlag.Multiline, options.multiline);
    flag(InputFlag.ReadOnly, options.readOnly);
    flag(InputFlag.Secure, options.secure);
    if (options.allow !== undefined) o.allow = String(options.allow);
    if (options.maxLength !== undefined) o.maxLength = Math.max(0, Math.floor(options.maxLength || 0));
    this.ui.markPending(this);
    return this;
  }

  /** Gives the Input the keyboard focus (FOCUS and BLUR events follow). */
  focus(): this {
    this.assertInput("focus");
    this.ui.enc.focus(this.id);
    this.ui.schedule();
    return this;
  }

  /**
   * Makes this node a focus scope (or stops it being one): while it's on
   * screen, Tab stays among the inputs inside the topmost scope, and when it
   * leaves the screen the focus goes back to the input that had it before.
   */
  focusScope(on: boolean): this {
    this.alive();
    const flags = on ? FocusScopeFlag.Trap | FocusScopeFlag.Restore : 0;
    if (flags === this.scopeFlags) return this;
    this.scopeFlags = flags;
    this.ui.enc.focusScope(this.id, flags);
    this.ui.schedule();
    return this;
  }
  private scopeFlags = 0;

  /**
   * Selects an Input's text from `start` to `end` (a caret at `start` if
   * left out), in UTF-16 code units, as the DOM's setSelectionRange counts;
   * clamped. The caret is at `end`. Applied after this turn's value, so
   * `setValue(t)` then `setSelection(t.length)` puts it after the new text.
   */
  setSelection(start: number, end = start): this {
    this.assertInput("setSelection");
    const ok = (n: number) => Number.isInteger(n) && n >= 0;
    if (!ok(start) || !ok(end)) throw new Error("mantou: setSelection takes offsets of 0 or more");
    this.pendingSelection = [Math.min(start, 0xffffffff), Math.min(end, 0xffffffff)];
    this.ui.markPending(this);
    return this;
  }

  /**
   * An Input's selection in UTF-16 code units (`start <= end`; equal for a
   * caret), after the changes made so far (committed first). Null without a
   * core (the mock).
   */
  selection(): { start: number; end: number } | null {
    this.assertInput("selection");
    const r = this.ui.selection(this);
    return r ? { start: Math.min(r[0], r[1]), end: Math.max(r[0], r[1]) } : null;
  }

  /** Takes the keyboard focus away from this Input, if it has it. */
  blur(): this {
    this.alive();
    if (this.ui.focused === this) {
      this.ui.enc.focus(0);
      this.ui.schedule();
    }
    return this;
  }

  /** Whether this Input has the keyboard focus (as the core last reported). */
  get focused(): boolean {
    return this.ui.focused === this;
  }

  /** Adds an Input handler: "change" (the user changed the text), "submit" (Enter), "focus", "blur". */
  onInput<K extends keyof InputHandlers>(type: K, handler: InputHandlers[K][number]): () => void {
    this.assertInput(`on${type[0].toUpperCase()}${type.slice(1)}`);
    const list = ((this.inputHandlers ??= { change: [], submit: [], focus: [], blur: [], select: [] })[type] as unknown[]);
    list.push(handler);
    if (type === "select" && list.length === 1) this.listen();
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
      if (type === "select" && list.length === 0 && !this.released) this.listen();
    };
  }

  /** @internal */
  handleInput(e: InputCoreEvent) {
    const h = this.inputHandlers;
    switch (e.type) {
      case "textChanged":
        if (e.rev < this.rev) return;
        this.value = e.text;
        this.rev = e.rev;
        for (const f of [...(h?.change ?? [])]) f(e.text);
        if (this.controlled !== undefined && !this.released) this.setValue(this.controlled);
        return;
      case "submit":
        for (const f of [...(h?.submit ?? [])]) f(this.value);
        return;
      case "selection": {
        const s = { start: Math.min(e.anchor, e.focus), end: Math.max(e.anchor, e.focus), anchor: e.anchor, focus: e.focus };
        for (const f of [...(h?.select ?? [])]) f(s);
        return;
      }
      case "focus":
        for (const f of [...(h?.focus ?? [])]) f();
        return;
      case "blur":
        for (const f of [...(h?.blur ?? [])]) f();
    }
  }

  /**
   * What screen readers are told about this node: a role (the default for the
   * kind when omitted), a name, and states. Sent once per turn.
   */
  access(a: AccessInfo): this {
    this.alive();
    this.acc = { ...this.acc, ...a };
    this.ui.markPending(this);
    return this;
  }
  private acc: AccessInfo = {};
  private sentAcc = "0,0,";

  /** @internal Sends what is batched until the end of the turn (text, input options). */
  flushPending() {
    if (this.released) return;
    {
      const a = this.acc;
      const role = a.role ? AccessRole[(a.role[0].toUpperCase() + a.role.slice(1)) as keyof typeof AccessRole] : 0;
      const flags = (a.checked === true ? AccessFlag.Checked : 0) | (a.checked === "mixed" ? AccessFlag.Mixed : 0) | (a.selected ? AccessFlag.Selected : 0) | (a.disabled ? AccessFlag.Disabled : 0) | (a.hidden ? AccessFlag.Hidden : 0);
      const label = a.label ?? "";
      const key = `${role},${flags},${label}`;
      if (key !== this.sentAcc) {
        this.sentAcc = key;
        this.ui.enc.access(this.id, role, flags, label);
      }
    }
    if (this.isText) {
      const text = this.textContent;
      if (text !== this.sentText) {
        this.sentText = text;
        this.ui.enc.text(this.id, text);
      }
    } else if (this.isInput) {
      const o = this.options, s = this.sentOptions;
      if (o.flags !== s.flags || o.maxLength !== s.maxLength) {
        this.ui.enc.inputOptions(this.id, o.flags, o.maxLength);
      }
      if (o.allow !== s.allow) this.ui.enc.inputAllow(this.id, o.allow);
      this.sentOptions = { ...o };
      // After the options: a multiline value keeps its newlines.
      const v = this.pendingValue;
      this.pendingValue = null;
      if (v) this.ui.enc.value(this.id, v.rev, v.text);
      // After the value, so it selects in the new text.
      const sel = this.pendingSelection;
      this.pendingSelection = null;
      if (sel) this.ui.enc.select(this.id, sel[0], sel[1]);
    }
  }

  /** A Text node's content: its text leaves joined. */
  get textContent(): string {
    let s = "";
    for (const c of this.children) if (c instanceof TextLeaf) s += c.text;
    return s;
  }

  /** @internal */
  textChanged() {
    if (this.isText && !this.released) this.ui.markPending(this);
  }

  /** Child nodes, without text leaves. */
  get elements(): Node[] {
    return this.children.filter((c): c is Node => c instanceof Node);
  }

  /** Sets style properties on this node; `undefined` removes one. Unchanged values send nothing. */
  style(style: Style): this {
    this.alive();
    for (const [prop, value] of expandStyle(style)) {
      if (value === undefined) {
        if (this.own.delete(prop)) this.ui.enc.styleReset(this.id, prop);
        continue;
      }
      const prev = this.own.get(prop);
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(value)) continue;
      this.own.set(prop, value);
      this.ui.enc.style(this.id, prop, this.ui.wireValue(prop, value));
    }
    this.ui.schedule();
    return this;
  }

  /** Applies a shared style (null for none). The node's own properties override it. */
  use(shared: SharedStyle | null): this {
    this.alive();
    if (this.shared === shared) return this;
    this.shared = shared;
    this.ui.enc.styleUse(this.id, shared ? this.ui.styleId(shared) : 0);
    this.ui.schedule();
    return this;
  }

  /** Appends a child (moving it if it is elsewhere). */
  append(child: Child): this {
    return this.insertBefore(child, null);
  }

  /**
   * Inserts or moves `child` before `before` (null = at the end). The core
   * only sees nodes, so a move that leaves a node's next node sibling unchanged
   * sends nothing (design §5.2 invariant 5), and text leaves never send ops.
   */
  insertBefore(child: Child, before: Child | null): this {
    this.alive();
    if (child instanceof Node) {
      child.alive();
      if (this.isText) throw new Error("mantou: <Text> holds only text; put views next to it, not inside it");
      if (this.isInput) throw new Error("mantou: <Input> has no children");
      if (this.isImage) throw new Error("mantou: <Image> has no children");
    } else if (!this.isText && child.text.trim()) {
      this.ui.warnText(child.text);
    }
    if (before && before.parent !== this) throw new Error("mantou: `before` is not a child of this node");
    if (child === before) return this;
    const wasHere = child.parent === this;
    const oldNext = wasHere ? this.nextNode(child) : undefined;
    if (wasHere) this.children.splice(this.children.indexOf(child), 1);
    else child.parent?.detach(child);
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at, 0, child);
    child.parent = this;
    if (child instanceof TextLeaf) this.textChanged();
    if (child instanceof Node) {
      const next = this.nextNode(child);
      if (wasHere && next === oldNext) return this;
      this.ui.enc.insert(this.id, child.id, next?.id ?? 0);
      this.ui.schedule();
    }
    return this;
  }

  /** The first node (not text leaf) after `child`, or null. */
  private nextNode(child: Child): Node | null {
    for (let i = this.children.indexOf(child) + 1; i < this.children.length; i++) {
      const c = this.children[i];
      if (c instanceof Node) return c;
    }
    return null;
  }

  /**
   * Detaches a child; it stays alive and can be inserted again until released.
   * A child that is no longer here (Solid may release a node before removing
   * it) is ignored.
   */
  remove(child: Child): this {
    if (child.parent !== this) return this;
    this.detach(child);
    if (child instanceof TextLeaf) this.textChanged();
    if (child instanceof Node && !this.released && !child.released) {
      this.ui.enc.remove(this.id, child.id);
      this.ui.schedule();
    }
    return this;
  }

  private detach(child: Child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parent = null;
  }

  /** Frees the node in the core. Its children are detached, not released. */
  release() {
    if (this.released) return;
    this.parent?.detach(this);
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this.pressHandlers.length = 0;
    this.wheelHandlers.length = 0;
    this.layoutHandlers.length = 0;
    this.scrollHandlers.length = 0;
    this.hoverHandlers.length = 0;
    this.dropHandlers.drop.length = this.dropHandlers.over.length = 0;
    for (const k of Object.keys(this.pointerHandlers) as (keyof typeof this.pointerHandlers)[]) this.pointerHandlers[k].length = 0;
    this.inputHandlers = null;
    this.released = true;
    for (const a of this.running) this.ui.endAnimation(a);
    this.ui.free(this);
  }

  /**
   * Sets which properties animate to their new values when they change
   * (design §9.4): `{ opacity: 200, translateY: { duration: 300, easing: "ease-out" } }`.
   * It replaces the node's transitions: properties left out stop
   * transitioning. The core runs them, with no JS per frame; it applies to
   * changes made after it.
   */
  transition(transitions: Transitions): this {
    this.alive();
    const next = new Map<AnimatableProp, [number, number]>();
    for (const [prop, spec] of Object.entries(transitions)) {
      if (spec === undefined) continue;
      const duration = typeof spec === "number" ? spec : spec.duration;
      if (!Number.isFinite(duration) || duration < 0) throw new Error(`mantou: transition ${prop}: the duration must be a number of ms`);
      next.set(animatable(prop), [duration, easingCode(typeof spec === "number" ? undefined : spec.easing)]);
    }
    for (const [prop, [d, e]] of next) {
      const old = this.transitions.get(prop);
      if (old && old[0] === d && old[1] === e) continue;
      this.ui.enc.transition(this.id, StyleProp[prop].code, d, e);
    }
    for (const prop of this.transitions.keys()) if (!next.has(prop)) this.ui.enc.transition(this.id, StyleProp[prop].code, 0, 0);
    this.transitions = next;
    this.ui.schedule();
    return this;
  }

  /**
   * Animates a property from one value to another (design §9.4). The core
   * runs it, with no JS per frame; when it ends, the property goes back to
   * the style's value. A new animation of the same property replaces it.
   */
  animate(prop: AnimatableProp, options: AnimateOptions): Animation {
    this.alive();
    const p = animatable(prop);
    const { duration, iterations = 1 } = options;
    if (!Number.isFinite(duration) || duration < 0) throw new Error(`mantou: animate ${prop}: the duration must be a number of ms`);
    if (Number.isNaN(iterations) || iterations < 0) throw new Error(`mantou: animate ${prop}: iterations must be 0 or more (or Infinity)`);
    const value = (v: number | Color) => {
      if (COLOURS.includes(p)) return parseColor(v as Color);
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`mantou: animate ${prop}: from and to must be numbers`);
      return f32bits(v);
    };
    const [from, to] = [value(options.from), value(options.to)];
    const id = this.ui.nextAnimation++;
    this.running.add(id);
    const finished = new Promise<void>((resolve) => this.ui.animations.set(id, () => {
      this.running.delete(id);
      resolve();
    }));
    this.ui.enc.animate(this.id, id, StyleProp[p].code, from, to, duration, easingCode(options.easing), iterations, options.alternate ? AnimateFlag.Alternate : 0);
    this.ui.schedule();
    return {
      finished,
      stop: () => {
        if (!this.running.has(id) || this.released) return;
        // A zero-length animation of the property (id 0: no event) replaces it, and ends at once.
        this.ui.enc.animate(this.id, 0, StyleProp[p].code, to, to, 0, 0, 1, 0);
        this.ui.schedule();
      },
    };
  }

  /**
   * Where the core laid this node out, after the changes made so far (they're
   * committed first). Null if it isn't laid out (detached, hidden) or there's
   * no core (the mock).
   */
  measure(): Rect | null {
    this.alive();
    return this.ui.measure(this);
  }

  /** Adds a press handler; returns a function that removes it. */
  onPress(handler: (e: PressEvent) => void): () => void {
    this.alive();
    this.pressHandlers.push(handler);
    if (this.pressHandlers.length === 1) this.listen();
    return () => {
      const i = this.pressHandlers.indexOf(handler);
      if (i < 0) return;
      this.pressHandlers.splice(i, 1);
      if (this.pressHandlers.length === 0 && !this.released) this.listen();
    };
  }

  private listen() {
    const mask =
      (this.pressHandlers.length ? EventMask.Press : 0) |
      (this.layoutHandlers.length ? EventMask.Layout : 0) |
      (this.scrollHandlers.length ? EventMask.Scroll : 0) |
      (this.hoverHandlers.length ? EventMask.Hover : 0) |
      (this.dropHandlers.drop.length || this.dropHandlers.over.length ? EventMask.Drop : 0) |
      (Object.values(this.pointerHandlers).some((h) => h.length) ? EventMask.Pointer : 0) |
      (this.inputHandlers?.select.length ? EventMask.Select : 0);
    this.ui.enc.listen(this.id, mask);
    this.ui.schedule();
  }

  /**
   * Adds a layout handler: it hears this node's box after the next layout,
   * then whenever the box changes (window resizes included). Returns a
   * function that removes it.
   */
  onLayout(handler: (rect: Rect) => void): () => void {
    this.alive();
    this.layoutHandlers.push(handler);
    if (this.layoutHandlers.length === 1) this.listen();
    return () => {
      const i = this.layoutHandlers.indexOf(handler);
      if (i < 0) return;
      this.layoutHandlers.splice(i, 1);
      if (this.layoutHandlers.length === 0 && !this.released) this.listen();
    };
  }

  /**
   * Adds a scroll handler to a scroll view (overflow: "scroll"): it hears the
   * offset after the core scrolls it, at most once per frame. Returns a
   * function that removes it.
   */
  onScroll(handler: (offset: ScrollOffset) => void): () => void {
    this.alive();
    this.scrollHandlers.push(handler);
    if (this.scrollHandlers.length === 1) this.listen();
    return () => {
      const i = this.scrollHandlers.indexOf(handler);
      if (i < 0) return;
      this.scrollHandlers.splice(i, 1);
      if (this.scrollHandlers.length === 0 && !this.released) this.listen();
    };
  }

  /**
   * Adds a hover handler: it hears `true` when the pointer comes over this
   * node (or anything inside it) and `false` when it leaves, including when
   * the node moves, hides or scrolls away from a still pointer. The core
   * tracks the pointer; only nodes with handlers hear about it. Returns a
   * function that removes it.
   */
  onHover(handler: (hovered: boolean) => void): () => void {
    this.alive();
    this.hoverHandlers.push(handler);
    if (this.hoverHandlers.length === 1) this.listen();
    return () => {
      const i = this.hoverHandlers.indexOf(handler);
      if (i < 0) return;
      this.hoverHandlers.splice(i, 1);
      if (this.hoverHandlers.length === 0 && !this.released) {
        this.hovered = false;
        this.listen();
      }
    };
  }

  private addPointer(kind: keyof typeof this.pointerHandlers, handler: (e: PointerEvent) => void): () => void {
    this.alive();
    const list = this.pointerHandlers[kind];
    const was = Object.values(this.pointerHandlers).some((h) => h.length);
    list.push(handler);
    if (!was) this.listen();
    return () => {
      const i = list.indexOf(handler);
      if (i < 0) return;
      list.splice(i, 1);
      if (!this.released && !Object.values(this.pointerHandlers).some((h) => h.length)) this.listen();
    };
  }

  /** A button went down on this node (or inside it). Returns a function that removes the handler. */
  onPointerDown(handler: (e: PointerEvent) => void): () => void {
    return this.addPointer("down", handler);
  }

  /** The pointer moved over this node, or, while a button is held that went down on it, anywhere. At most one per batch. */
  onPointerMove(handler: (e: PointerEvent) => void): () => void {
    return this.addPointer("move", handler);
  }

  /** A button came up; after a press on this node, wherever the pointer is. */
  onPointerUp(handler: (e: PointerEvent) => void): () => void {
    return this.addPointer("up", handler);
  }

  /** The secondary button went down (on macOS also Control + the primary button): the place for `showMenu`. */
  onContextMenu(handler: (e: PointerEvent) => void): () => void {
    return this.addPointer("context", handler);
  }

  /** The primary button went down for the second time in a row at one spot. */
  onDoubleClick(handler: (e: PointerEvent) => void): () => void {
    return this.addPointer("double", handler);
  }

  /** @internal Runs the handlers for one pointer event; true when one stopped it from bubbling. */
  handlePointer(kind: 0 | 1 | 2, e: Omit<PointerEvent, "currentTarget" | "stopPropagation">): boolean {
    let stopped = false;
    const ev = { ...e, currentTarget: this, stopPropagation: () => (stopped = true) };
    const run = (list: ((e: PointerEvent) => void)[]) => {
      for (const h of [...list]) h(ev);
    };
    const h = this.pointerHandlers;
    if (kind === 0) {
      run(h.down);
      if (e.button === 2 || (isMac && e.button === 0 && e.ctrl)) run(h.context);
      else if (e.button === 0 && e.clicks === 2) run(h.double);
    } else if (kind === 1) run(h.up);
    else run(h.move);
    return stopped;
  }

  private addDrop<K extends "drop" | "over">(kind: K, handler: Node["dropHandlers"][K][number]): () => void {
    this.alive();
    const list = this.dropHandlers[kind] as unknown[];
    list.push(handler);
    if (list.length === 1) this.listen();
    return () => {
      const i = list.indexOf(handler);
      if (i < 0) return;
      list.splice(i, 1);
      if (!this.released) this.listen();
    };
  }

  /** Files were dropped on this node (or inside it). Returns a function that removes the handler. */
  onDrop(handler: (e: DropEvent) => void): () => void {
    return this.addDrop("drop", handler);
  }

  /** Files are held over this node (called with the event), or left it or the window (called with null). */
  onDragOver(handler: (e: DropEvent | null) => void): () => void {
    return this.addDrop("over", handler);
  }

  private dragData: { value: unknown } | null = null;
  private dragOff: (() => void)[] = [];

  /**
   * Makes the node draggable inside the app: after the pointer moves a few px with the primary button held,
   * views under it hear `onDragOver` (an event with `data: value`, null when it leaves) and, on release, `onDrop`.
   * `undefined` turns it off. Nothing is drawn for the drag; show it with `onDragOver` on the target and state on the source.
   */
  draggable(value: unknown): void {
    this.alive();
    const was = this.dragData !== null;
    this.dragData = value === undefined ? null : { value };
    if (was === (value !== undefined)) return;
    if (value === undefined) {
      this.dragOff.splice(0).forEach((f) => f());
      return;
    }
    let from: { x: number; y: number } | null = null;
    this.dragOff.push(
      this.onPointerDown((e) => {
        if (e.button === 0 && e.target === this.ui.nodes.get(e.target.id) && e.currentTarget === this) from = { x: e.x, y: e.y };
      }),
      this.onPointerMove((e) => {
        if (!from || !(e.buttons & 1)) return;
        if (!this.ui.dragging && Math.hypot(e.x - from.x, e.y - from.y) < 4) return;
        this.ui.dragMove(this, this.dragData!.value, e.x, e.y, 0);
      }),
      this.onPointerUp((e) => {
        if (from && this.ui.dragging) this.ui.dragMove(this, this.dragData!.value, e.x, e.y, 2);
        from = null;
      }),
    );
  }

  /** @internal */
  handleDrop(kind: 0 | 1 | 2, e: Omit<DropEvent, "currentTarget" | "stopPropagation"> | null): { stopped: boolean; ran: boolean } {
    let stopped = false;
    const ran = kind === 2 ? this.dropHandlers.drop.length > 0 : this.dropHandlers.over.length > 0;
    if (kind === 2 && e) {
      for (const h of [...this.dropHandlers.drop]) h({ ...e, currentTarget: this, stopPropagation: () => (stopped = true) });
    } else if (kind === 0 && e) {
      for (const h of [...this.dropHandlers.over]) h({ ...e, currentTarget: this, stopPropagation: () => (stopped = true) });
    } else for (const h of [...this.dropHandlers.over]) h(null);
    return { stopped, ran };
  }

  /** @internal */
  handleHover(hovered: boolean) {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    for (const h of [...this.hoverHandlers]) h(hovered);
  }

  /** @internal */
  handleScroll(offset: ScrollOffset) {
    this.scrollOffset = offset;
    for (const h of [...this.scrollHandlers]) h(offset);
  }

  /** Scrolls this scroll view to an offset (an axis left out stays), clamped, after this turn's layout. */
  scrollTo(to: Partial<ScrollOffset>): this {
    this.alive();
    this.ui.enc.scrollTo(this.id, to.x ?? NaN, to.y ?? NaN, 0);
    this.ui.schedule();
    return this;
  }

  /** Scrolls this scroll view by an amount, clamped, after this turn's layout. */
  scrollBy(by: Partial<ScrollOffset>): this {
    this.alive();
    this.ui.enc.scrollTo(this.id, by.x ?? 0, by.y ?? 0, ScrollFlag.By);
    this.ui.schedule();
    return this;
  }

  /**
   * Scrolls the scroll views around this node so it shows, after this turn's
   * layout (so a node added in the same turn works). `block` is where it ends
   * up vertically; sideways, it moves as little as it can.
   */
  scrollIntoView(options: { block?: ScrollBlockName } = {}): this {
    this.alive();
    const block = { nearest: ScrollBlock.Nearest, start: ScrollBlock.Start, center: ScrollBlock.Center, end: ScrollBlock.End }[options.block ?? "nearest"];
    this.ui.enc.scrollIntoView(this.id, block);
    this.ui.schedule();
    return this;
  }

  /** @internal */
  handleLayout(rect: Rect) {
    this.layout = rect;
    for (const h of [...this.layoutHandlers]) h(rect);
  }

  /** Adds a wheel handler; returns a function that removes it. Wheel events bubble like presses. */
  onWheel(handler: (e: WheelEvent) => void): () => void {
    this.alive();
    this.wheelHandlers.push(handler);
    return () => {
      const i = this.wheelHandlers.indexOf(handler);
      if (i >= 0) this.wheelHandlers.splice(i, 1);
    };
  }

  /** @internal */
  handleWheel(e: WheelEvent): boolean {
    let stopped = false;
    for (const h of [...this.wheelHandlers]) h({ ...e, currentTarget: this, stopPropagation: () => (stopped = true) });
    return stopped;
  }

  /** @internal */
  handlePress(e: PressEvent): boolean {
    let stopped = false;
    for (const h of [...this.pressHandlers]) {
      h({ ...e, currentTarget: this, stopPropagation: () => (stopped = true) });
    }
    return stopped;
  }

  private alive() {
    if (this.released) throw new Error(`mantou: node ${this.id} was released`);
  }
}

export class Ui {
  readonly enc = new OpEncoder();
  readonly nodes = new Map<number, Node>();
  /** Commits sent, and ops in the last one. */
  commits = 0;
  lastCommitOps = 0;

  private scheduled = false;
  private nextId = 1;
  private freeIds: number[] = [];
  private nextStyleId = 1;
  private styleIds = new WeakMap<SharedStyle, number>();
  private root: Node | null = null;
  private pendingNodes = new Set<Node>();
  private keyHandlers = new Set<(e: KeyEvent) => void>();
  private warnedText = false;
  /** The Input with the keyboard focus, as the core last reported. */
  focused: Node | null = null;
  /** The window's size, once the core has reported it (a headless instance knows it from the start). */
  windowSize: WindowSize | null = null;
  private resizeHandlers = new Set<(size: WindowSize) => void>();

  constructor(private sink: Sink) {}

  private nextRequest = 1;
  private requests = new Map<number, (answer: unknown | null) => void>();
  private menuHandlers = new Set<(id: string) => void>();

  /** Asks the platform for a service (design §10); resolves to its answer, or null when the user cancelled. */
  service<T>(request: { kind: string } & Record<string, unknown>): Promise<T | null> {
    if (!this.sink.service) return Promise.resolve(null);
    const req = this.nextRequest++;
    return new Promise((resolve) => {
      this.requests.set(req, resolve as (a: unknown) => void);
      this.sink.service!(req, JSON.stringify(request));
    });
  }

  /** Delivers a service's answer to the promise that asked. */
  dispatchService(req: number, cancelled: boolean, json: string) {
    const resolve = this.requests.get(req);
    this.requests.delete(req);
    resolve?.(cancelled || !json ? null : JSON.parse(json));
  }

  /** Listens for the app menu's items being chosen; returns a function that stops. */
  onMenu(handler: (id: string) => void): () => void {
    this.menuHandlers.add(handler);
    return () => this.menuHandlers.delete(handler);
  }

  /** Files held over, left or dropped: the target and its ancestors hear it, then the window-level listeners. */
  dispatchDrop(kind: 0 | 1 | 2, targetId: number, json: string) {
    const { x, y, files } = JSON.parse(json) as { x: number; y: number; files: string[] };
    const target = this.nodes.get(targetId) ?? null;
    const e = { target, x, y, files };
    // The node that was over is told when files move on or leave.
    const was = this.dragOver;
    this.dragOver = kind === 0 ? target : null;
    let ran = false;
    if (was && was !== target) for (let n: Node | null = was; n; n = n.parent) ran = n.handleDrop(1, null).ran || ran;
    for (let n: Node | null = target; n; n = n.parent) {
      const r = n.handleDrop(kind, e);
      ran = ran || r.ran;
      if (r.stopped) break;
    }
    // A drop that no view took goes to the window listeners.
    if (!ran) for (const h of [...this.dropListeners]) h(kind, e);
  }

  /** True while a view of the app is being dragged. */
  dragging = false;

  /** @internal The dragged view moved (kind 0) or was released (2) at (x, y). */
  dragMove(source: Node, data: unknown, x: number, y: number, kind: 0 | 2) {
    this.dragging = kind === 0;
    const id = this.sink.hit?.(x, y) ?? 0;
    let target = this.nodes.get(id) ?? null;
    if (target === source) target = null; // the dragged view itself isn't a target (nor is its inside)
    for (let n = target; n; n = n.parent) if (n === source) target = null;
    const e = { target, x, y, files: [], data };
    const was = this.dragOver;
    if (kind === 0 && target === was) return; // still over the same view
    this.dragOver = kind === 0 ? target : null;
    if (was && was !== target) for (let n: Node | null = was; n; n = n.parent) n.handleDrop(1, null);
    for (let n: Node | null = target; n; n = n.parent) if (n.handleDrop(kind, e).stopped) break;
  }

  private dragOver: Node | null = null;
  private dropListeners = new Set<(kind: 0 | 1 | 2, e: { target: Node | null; x: number; y: number; files: string[] }) => void>();

  /** Window-level: files held over the window (kind 0), left it (1) or dropped on it (2), when no node took them. */
  onFileDrop(handler: (kind: 0 | 1 | 2, e: { target: Node | null; x: number; y: number; files: string[] }) => void): () => void {
    this.dropListeners.add(handler);
    return () => this.dropListeners.delete(handler);
  }

  private stateHandlers = new Set<(s: WindowState) => void>();
  /** The window's state as last reported by the core (before the first report: not focused, nowhere). */
  windowState: WindowState = { focused: false, minimized: false, maximized: false, fullscreen: false, dark: false, x: 0, y: 0 };

  /** Listens for the window's focus, position, minimized, maximized and full screen state changing. */
  onWindowState(handler: (s: WindowState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  dispatchWindowState(flags: number, x: number, y: number) {
    this.windowState = {
      focused: !!(flags & WindowStateFlag.Focused),
      minimized: !!(flags & WindowStateFlag.Minimized),
      maximized: !!(flags & WindowStateFlag.Maximized),
      fullscreen: !!(flags & WindowStateFlag.Fullscreen),
      dark: !!(flags & WindowStateFlag.Dark),
      x,
      y,
    };
    for (const h of [...this.stateHandlers]) h(this.windowState);
  }

  dispatchMenu(id: string) {
    for (const h of [...this.menuHandlers]) h(id);
  }

  /** Creates an Input: a text field (multiline with setOptions). */
  input(...styles: (Style | SharedStyle)[]): Node {
    const id = this.freeIds.pop() ?? this.nextId++;
    const node = new Node(this, id, NodeKind.Input);
    this.nodes.set(id, node);
    this.enc.create(id, NodeKind.Input);
    for (const s of styles) s instanceof SharedStyle ? node.use(s) : node.style(s);
    this.schedule();
    return node;
  }

  /** Listens for the window's size changing; returns a function that stops. */
  onResize(handler: (size: WindowSize) => void): () => void {
    this.resizeHandlers.add(handler);
    return () => this.resizeHandlers.delete(handler);
  }

  /** Records the window's size (logical px) and tells resize listeners if it changed. */
  dispatchResize(width: number, height: number, scale: number) {
    const s = this.windowSize;
    if (s && s.width === width && s.height === height && s.scale === scale) return;
    const size = { width, height, scale };
    this.windowSize = size;
    for (const h of [...this.resizeHandlers]) h(size);
  }

  /** Delivers an Image's load or error to its handlers. */
  dispatchImage(targetId: number, result: { width: number; height: number } | { error: string }) {
    this.nodes.get(targetId)?.handleImage(result);
  }

  /** Creates an Image (set its source with `src`). */
  image(...styles: (Style | SharedStyle)[]): Node {
    const id = this.freeIds.pop() ?? this.nextId++;
    const node = new Node(this, id, NodeKind.Image);
    this.nodes.set(id, node);
    this.enc.create(id, NodeKind.Image);
    for (const s of styles) s instanceof SharedStyle ? node.use(s) : node.style(s);
    this.schedule();
    return node;
  }

  /** Delivers a scroll view's new offset to its scroll handlers. */
  dispatchScroll(targetId: number, x: number, y: number) {
    this.nodes.get(targetId)?.handleScroll({ x, y });
  }

  /** @internal Animation ids, and what to do when each ends. */
  animations = new Map<number, () => void>();
  /** @internal */
  nextAnimation = 1;

  /** An ANIMATE ended (ANIMATION_END). */
  dispatchAnimationEnd(animation: number) {
    this.endAnimation(animation);
  }

  /** @internal */
  endAnimation(animation: number) {
    const end = this.animations.get(animation);
    this.animations.delete(animation);
    end?.();
  }

  /** Delivers a node's new box to its layout handlers. */
  dispatchLayout(targetId: number, rect: Rect) {
    this.nodes.get(targetId)?.handleLayout(rect);
  }

  /** Delivers an Input event (focus, blur, a text change, submit) to its node. */
  dispatchInput(e: InputCoreEvent) {
    const node = this.nodes.get(e.target);
    if (e.type === "focus") this.focused = node ?? null;
    else if (e.type === "blur" && this.focused?.id === e.target) this.focused = null;
    node?.handleInput(e);
  }

  /** Creates a Text node; its content is the text leaves put inside it. */
  textNode(...styles: (Style | SharedStyle)[]): Node {
    const id = this.freeIds.pop() ?? this.nextId++;
    const node = new Node(this, id, NodeKind.Text);
    this.nodes.set(id, node);
    this.enc.create(id, NodeKind.Text);
    for (const s of styles) s instanceof SharedStyle ? node.use(s) : node.style(s);
    this.schedule();
    return node;
  }

  /** @internal */
  markPending(node: Node) {
    this.pendingNodes.add(node);
    this.schedule();
  }

  /** @internal */
  warnText(text: string) {
    if (this.warnedText) return;
    this.warnedText = true;
    console.warn(`mantou: text outside <Text> isn't drawn ("${text.trim().slice(0, 40)}"); wrap it in <Text>`);
  }

  /** Listens for keys anywhere in the window; returns a function that stops. */
  onKey(handler: (e: KeyEvent) => void): () => void {
    this.keyHandlers.add(handler);
    return () => this.keyHandlers.delete(handler);
  }

  /** Delivers a key event to every key listener. */
  dispatchKey(e: KeyEvent) {
    for (const h of [...this.keyHandlers]) h(e);
  }

  /** Delivers a wheel event to its target and bubbles it up the tree. */
  dispatchWheel(targetId: number, dx: number, dy: number) {
    const target = this.nodes.get(targetId);
    if (!target) return;
    const e = { target, currentTarget: target, dx, dy, stopPropagation() {} };
    for (let n: Node | null = target; n; n = n.parent) if (n.handleWheel(e)) break;
  }

  /** Creates a view, optionally with a shared style and/or its own style. */
  view(...styles: (Style | SharedStyle)[]): Node {
    const id = this.freeIds.pop() ?? this.nextId++;
    const node = new Node(this, id, NodeKind.View);
    this.nodes.set(id, node);
    this.enc.create(id, NodeKind.View);
    for (const s of styles) s instanceof SharedStyle ? node.use(s) : node.style(s);
    this.schedule();
    return node;
  }

  /** Creates a text leaf (see TextLeaf). */
  text(value: string): TextLeaf {
    return new TextLeaf(value);
  }

  /** Defines a style and sends its definition now. */
  defineStyle(style: Style): SharedStyle {
    const shared = new SharedStyle(style);
    this.styleId(shared);
    return shared;
  }

  /**
   * Registers a font file (TTF, OTF or a collection) with this Ui's core.
   * Text then uses it by its family name: `fontFamily: "Lucide"`. Text laid
   * out before is laid out again, in case the font changes its fallback.
   */
  registerFont(data: Uint8Array): this {
    this.enc.font(data);
    this.schedule();
    return this;
  }

  private families = new Map<string, number>();

  /** @internal A style value as the wire wants it: font family names become a FONT_FAMILY id. */
  wireValue(prop: StylePropName, value: unknown): unknown {
    if (StyleProp[prop].kind !== "family") return value;
    const names = (Array.isArray(value) ? value : [value]).map((n) => String(n).trim()).filter(Boolean).join(", ");
    if (!names) return 0;
    let id = this.families.get(names);
    if (id === undefined) {
      id = this.families.size + 1;
      this.families.set(names, id);
      this.enc.fontFamily(id, names);
    }
    return id;
  }

  /** @internal The id of a shared style in this Ui, sending its definition the first time. */
  styleId(shared: SharedStyle): number {
    let id = this.styleIds.get(shared);
    if (id === undefined) {
      id = this.nextStyleId++;
      this.styleIds.set(shared, id);
      const props = [...expandStyle(shared.style)].filter(([, v]) => v !== undefined).map(([p, v]): [StylePropName, unknown] => [p, this.wireValue(p, v)]);
      this.enc.styleDef(id, props);
      this.schedule();
    }
    return id;
  }

  setRoot(node: Node | null) {
    if (this.root === node) return;
    this.root = node;
    this.enc.setRoot(node?.id ?? 0);
    this.schedule();
  }

  clearColor(r: number, g: number, b: number, a = 1) {
    this.enc.clearColor(r, g, b, a);
    this.schedule();
  }

  title(s: string) {
    this.enc.title(s);
    this.schedule();
  }

  /** Resizes the window's content area (logical px). A headless instance resizes its viewport. */
  setWindowSize(size: { width: number; height: number }) {
    this.enc.windowSize(size.width, size.height);
    this.schedule();
  }

  /** The window's smallest and largest content size (logical px; leave one out for no limit), and whether the user can resize it. */
  setWindowLimits(limits: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; resizable?: boolean }) {
    const v = (n: number | undefined) => Math.max(0, n ?? 0);
    this.enc.windowLimits(v(limits.minWidth), v(limits.minHeight), v(limits.maxWidth), v(limits.maxHeight), limits.resizable === false ? WindowFlag.NotResizable : 0);
    this.schedule();
  }

  /** @internal */
  free(node: Node) {
    this.nodes.delete(node.id);
    if (this.root === node) this.root = null;
    if (this.focused === node) this.focused = null;
    this.enc.release(node.id);
    this.freeIds.push(node.id);
    this.schedule();
  }

  /** @internal */
  selection(node: Node): [number, number] | null {
    if (!this.sink.selection) return null;
    this.flush();
    return this.sink.selection(node.id);
  }

  /** The pointer came over a node with hover handlers, or left it. */
  dispatchHover(targetId: number, hovered: boolean) {
    this.nodes.get(targetId)?.handleHover(hovered);
  }

  /** @internal */
  measure(node: Node): Rect | null {
    if (!this.sink.rect) return null;
    this.flush();
    const r = this.sink.rect(node.id);
    return r ? { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] } : null;
  }

  /** One commit per JS turn (design §5.2 invariant 3). */
  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush() {
    this.scheduled = false;
    for (const node of this.pendingNodes) node.flushPending();
    this.pendingNodes.clear();
    if (this.enc.empty) return;
    this.lastCommitOps = this.enc.ops;
    const bytes = this.enc.take();
    this.commits++;
    this.sink.commit(bytes);
  }

  /** Delivers a pointer event to its target and bubbles it up the tree. */
  dispatchPointer(e: { target: number; kind: 0 | 1 | 2; x: number; y: number; button: number; buttons: number; mods: number; clicks: number }) {
    const target = this.nodes.get(e.target);
    if (!target) return;
    const info = {
      target,
      x: e.x,
      y: e.y,
      button: e.button,
      buttons: e.buttons,
      shift: !!(e.mods & KeyModifier.Shift),
      ctrl: !!(e.mods & KeyModifier.Control),
      alt: !!(e.mods & KeyModifier.Alt),
      meta: !!(e.mods & KeyModifier.Meta),
      clicks: e.clicks,
    };
    for (let n: Node | null = target; n; n = n.parent) if (n.handlePointer(e.kind, info)) break;
  }

  /** Delivers a press to its target and bubbles it up the tree. */
  dispatchPress(targetId: number, x: number, y: number) {
    const target = this.nodes.get(targetId);
    if (!target) return;
    const e = { target, currentTarget: target, x, y, stopPropagation() {} };
    for (let n: Node | null = target; n; n = n.parent) if (n.handlePress(e)) break;
  }
}
