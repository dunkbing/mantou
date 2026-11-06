// What's on screen, for tests and agents: the app's tree with each node's box as drawn (transforms and
// animations applied), what of it shows inside its clips, its opacity, and what the app named it
// (`testId`), its text and what screen readers hear.
import { TextLeaf, type Node, type Ui } from "./ui";

export interface PresentedNode {
  id: number;
  kind: string;
  testId?: string;
  /** A Text's text; an Input's value. */
  text?: string;
  role?: string;
  label?: string;
  checked?: boolean | "mixed";
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  /** Its box as drawn, [x, y, width, height] in logical px from the window's top left; null when not placed. */
  rect: [number, number, number, number] | null;
  /** What of it shows inside its ancestors' clips (and the window); null when none does. */
  visible: [number, number, number, number] | null;
  /** Drawn opacity, its ancestors' included (0 = invisible). */
  opacity: number;
  /** An animation moves or fades it (or an ancestor) right now. */
  animating?: true;
  focused?: true;
  children: PresentedNode[];
}

/** Per placed box: drawn rect, visible rect, opacity, animating (from the core's `presented` dump). */
export type Presented = Map<number, { rect: number[]; visible: number[] | null; opacity: number; animating: boolean }>;

export function parsePresented(text: string, viewport: [number, number]): Presented {
  const out: Presented = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.split(" ").map(Number);
    const v = [Math.max(f[5], 0), Math.max(f[6], 0), Math.min(f[7], viewport[0]), Math.min(f[8], viewport[1])];
    out.set(f[0], { rect: f.slice(1, 5), visible: v[2] > v[0] && v[3] > v[1] ? v : null, opacity: f[9], animating: f[10] === 1 });
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const xywh = (r: number[]): [number, number, number, number] => [r1(r[0]), r1(r[1]), r1(r[2] - r[0]), r1(r[3] - r[1])];

export function presentedTree(ui: Ui, boxes: Presented, focused: Node | null, value: (n: Node) => string | null, root?: Node): PresentedNode | null {
  const start = root ?? ui.rootNode;
  if (!start) return null;
  const walk = (n: Node): PresentedNode => {
    const b = boxes.get(n.id);
    const a = n.accessInfo;
    const out: PresentedNode = { id: n.id, kind: n.kindName, rect: b ? xywh(b.rect) : null, visible: b?.visible ? xywh(b.visible) : null, opacity: b ? r1(b.opacity * 100) / 100 : 0, children: [] };
    if (n.testId) out.testId = n.testId;
    if (n.isText) out.text = n.textContent;
    if (n.isInput) out.text = value(n) ?? "";
    if (a.role) out.role = a.role;
    if (a.label) out.label = a.label;
    if (a.checked !== undefined) out.checked = a.checked;
    if (a.selected) out.selected = true;
    if (a.disabled) out.disabled = true;
    if (a.expanded !== undefined) out.expanded = a.expanded;
    if (b?.animating) out.animating = true;
    if (focused === n) out.focused = true;
    // A Text's spans are part of its text, not boxes of their own.
    if (!n.isText) for (const c of n.children) if (!(c instanceof TextLeaf)) out.children.push(walk(c));
    return out;
  };
  return walk(start);
}

/**
 * The tree as compact text, one node per line, for reading at a glance (and for agents): kind#id, [testId],
 * "text", `x,y w×h` as drawn, then what's notable: role and label, states, `hidden` (nothing of it shows),
 * `clipped` (part of it doesn't), its opacity when not 1, `animating`, `focused`.
 */
export function treeText(node: PresentedNode | null, depth = 0): string {
  if (!node) return "(no tree)";
  const parts = [`${"  ".repeat(depth)}${node.kind}#${node.id}`];
  if (node.testId) parts.push(`[${node.testId}]`);
  if (node.text !== undefined && node.text !== "") parts.push(JSON.stringify(node.text.length > 60 ? `${node.text.slice(0, 57)}…` : node.text));
  const r = node.rect;
  parts.push(r ? `${r[0]},${r[1]} ${r[2]}×${r[3]}` : "not placed");
  if (node.role) parts.push(`role=${node.role}`);
  if (node.label) parts.push(`label=${JSON.stringify(node.label)}`);
  if (node.checked !== undefined) parts.push(node.checked === "mixed" ? "mixed" : node.checked ? "checked" : "unchecked");
  if (node.selected) parts.push("selected");
  if (node.disabled) parts.push("disabled");
  if (node.expanded !== undefined) parts.push(node.expanded ? "expanded" : "collapsed");
  if (r && !node.visible) parts.push("hidden");
  else if (r && node.visible && (node.visible[2] < r[2] - 0.5 || node.visible[3] < r[3] - 0.5)) parts.push("clipped");
  if (r && node.opacity !== 1) parts.push(`opacity=${node.opacity}`);
  if (node.animating) parts.push("animating");
  if (node.focused) parts.push("focused");
  return [parts.join(" "), ...node.children.map((c) => treeText(c, depth + 1))].join("\n");
}

/** Every testId in the tree, for an error that says what's there. */
export function testIds(ui: Ui): string[] {
  const ids = new Set<string>();
  for (const n of ui.nodes.values()) if (n.testId && !n.released) ids.add(n.testId);
  return [...ids];
}
