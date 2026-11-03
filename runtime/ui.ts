// The Worker's mirror of the UI tree. Every mutation updates the mirror and
// appends an op; the batch is committed once per JS turn (design §7, §8).
// The Solid renderer (runtime/solid) drives this layer; apps can use it
// directly too.
import { EventMask, InputFlag, NodeKind, type StylePropName } from "./gen/protocol";
import { OpEncoder } from "./encoder";
import type { InputCoreEvent } from "./events";
import { expandStyle, type Style } from "./style";

export type { Style } from "./style";

/** Where committed batches go: the native core, or a mock in tests. */
export interface Sink {
  commit(bytes: Uint8Array): void;
  /** The node's laid-out box [x0, y0, x1, y1] in logical px, if the sink lays out. */
  rect?(id: number): [number, number, number, number] | null;
}

/** A laid-out box, in logical px from the window's top left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  readOnly?: boolean;
  /** In characters; 0 = no limit. */
  maxLength?: number;
}

type InputHandlers = {
  change: ((value: string) => void)[];
  submit: ((value: string) => void)[];
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
  private placeholderText = "";
  private options = { flags: 0, maxLength: 0 };
  private sentOptions = { flags: 0, maxLength: 0 };
  private inputHandlers: InputHandlers | null = null;

  constructor(readonly ui: Ui, readonly id: number, readonly kind: number) {}

  get isText(): boolean {
    return this.kind === NodeKind.Text;
  }

  get isInput(): boolean {
    return this.kind === NodeKind.Input;
  }

  /** A name for messages: "View", "Text" or "Input". */
  get kindName(): string {
    return this.isText ? "Text" : this.isInput ? "Input" : "View";
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
    const list = ((this.inputHandlers ??= { change: [], submit: [], focus: [], blur: [] })[type] as unknown[]);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
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
      case "focus":
        for (const f of [...(h?.focus ?? [])]) f();
        return;
      case "blur":
        for (const f of [...(h?.blur ?? [])]) f();
    }
  }

  /** @internal Sends what is batched until the end of the turn (text, input options). */
  flushPending() {
    if (this.released) return;
    if (this.isText) {
      const text = this.textContent;
      if (text !== this.sentText) {
        this.sentText = text;
        this.ui.enc.text(this.id, text);
      }
    } else if (this.isInput) {
      const o = this.options, s = this.sentOptions;
      if (o.flags !== s.flags || o.maxLength !== s.maxLength) {
        this.sentOptions = { ...o };
        this.ui.enc.inputOptions(this.id, o.flags, o.maxLength);
      }
      // After the options: a multiline value keeps its newlines.
      const v = this.pendingValue;
      this.pendingValue = null;
      if (v) this.ui.enc.value(this.id, v.rev, v.text);
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
      this.ui.enc.style(this.id, prop, value);
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
    this.inputHandlers = null;
    this.released = true;
    this.ui.free(this);
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
    this.ui.enc.listen(this.id, this.pressHandlers.length ? EventMask.Press : 0);
    this.ui.schedule();
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

  constructor(private sink: Sink) {}

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

  /** @internal The id of a shared style in this Ui, sending its definition the first time. */
  styleId(shared: SharedStyle): number {
    let id = this.styleIds.get(shared);
    if (id === undefined) {
      id = this.nextStyleId++;
      this.styleIds.set(shared, id);
      this.enc.styleDef(id, expandStyle(shared.style));
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

  /** Delivers a press to its target and bubbles it up the tree. */
  dispatchPress(targetId: number, x: number, y: number) {
    const target = this.nodes.get(targetId);
    if (!target) return;
    const e = { target, currentTarget: target, x, y, stopPropagation() {} };
    for (let n: Node | null = target; n; n = n.parent) if (n.handlePress(e)) break;
  }
}
