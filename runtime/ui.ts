// The Worker's mirror of the UI tree. Every mutation updates the mirror and
// appends an op; the batch is committed once per JS turn (DESIGN.md §7, §8).
// This is the layer the Solid renderer will sit on in M4; for now apps use it
// directly.
import { EventMask, NodeKind, type StylePropName } from "./gen/protocol";
import { OpEncoder } from "./encoder";
import { expandStyle, type Style } from "./style";

export type { Style } from "./style";

/** Where committed batches go: the native core, or a mock in tests. */
export interface Sink {
  commit(bytes: Uint8Array): void;
}

export interface PressEvent {
  target: Node;
  /** The node whose handler is running. */
  currentTarget: Node;
  x: number;
  y: number;
  stopPropagation(): void;
}

/** A style defined once and shared by many nodes (STYLE_DEF / STYLE_USE). */
export class SharedStyle {
  constructor(readonly id: number, readonly style: Style) {}
}

export class Node {
  parent: Node | null = null;
  readonly children: Node[] = [];
  released = false;
  private own = new Map<StylePropName, unknown>();
  private shared: SharedStyle | null = null;
  private pressHandlers: ((e: PressEvent) => void)[] = [];

  constructor(readonly ui: Ui, readonly id: number, readonly kind: number) {}

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
    this.ui.enc.styleUse(this.id, shared?.id ?? 0);
    this.ui.schedule();
    return this;
  }

  /** Appends a child (moving it if it is elsewhere). */
  append(child: Node): this {
    return this.insertBefore(child, null);
  }

  /** Inserts or moves `child` before `before` (null = at the end). A node already in place sends nothing. */
  insertBefore(child: Node, before: Node | null): this {
    this.alive();
    child.alive();
    if (before && before.parent !== this) throw new Error("mantou: `before` is not a child of this node");
    if (child === before) return this;
    if (child.parent === this) {
      const i = this.children.indexOf(child);
      if ((this.children[i + 1] ?? null) === before) return this; // already in place (DESIGN.md §5.2 invariant 5)
      this.children.splice(i, 1);
    } else {
      child.parent?.detach(child);
    }
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at, 0, child);
    child.parent = this;
    this.ui.enc.insert(this.id, child.id, before?.id ?? 0);
    this.ui.schedule();
    return this;
  }

  /** Detaches a child. It stays alive and can be inserted again until released. */
  remove(child: Node): this {
    this.alive();
    if (child.parent !== this) throw new Error("mantou: not a child of this node");
    this.detach(child);
    this.ui.enc.remove(this.id, child.id);
    this.ui.schedule();
    return this;
  }

  private detach(child: Node) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parent = null;
  }

  /** Frees the node in the core. Its children are detached, not released. */
  release() {
    if (this.released) return;
    this.parent?.detach(this);
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this.released = true;
    this.ui.free(this);
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
  private root: Node | null = null;

  constructor(private sink: Sink) {}

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

  /** Defines a style once; nodes then reference it with a single op each. */
  defineStyle(style: Style): SharedStyle {
    const shared = new SharedStyle(this.nextStyleId++, style);
    this.enc.styleDef(shared.id, expandStyle(style));
    this.schedule();
    return shared;
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
    this.enc.release(node.id);
    this.freeIds.push(node.id);
    this.schedule();
  }

  /** One commit per JS turn (DESIGN.md §5.2 invariant 3). */
  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush() {
    this.scheduled = false;
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
