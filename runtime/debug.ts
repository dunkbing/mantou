// Tools for finding out why something looks wrong. `dumpTree()` prints the tree the app has built, with
// the boxes the core laid out; MANTOU_DEBUG=layout (an environment variable) outlines every box in the window.
import { NodeKind } from "./gen/protocol";
import { activeUi } from "./platform";
import { TextLeaf, type Node } from "./ui";

const KIND: Record<number, string> = { [NodeKind.View]: "View", [NodeKind.Text]: "Text", [NodeKind.Input]: "Input", [NodeKind.Image]: "Image" };
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The tree under `root` (default: the app's root) as text: one line per node with its id, its box as
 * `x,y w×h` in logical px from the window's top left (as the core laid it out), and its text.
 * Commits pending changes first, like `node.measure()`.
 */
export function dumpTree(root?: Node): string {
  const start = root ?? activeUi()?.rootNode;
  if (!start) return "(no tree)";
  const lines: string[] = [];
  const walk = (n: Node, depth: number) => {
    const r = n.measure();
    const box = r ? `${round(r.x)},${round(r.y)} ${round(r.width)}×${round(r.height)}` : "not laid out";
    const text = n.isText || n.kind === NodeKind.Input ? ` ${JSON.stringify(n.kind === NodeKind.Input ? "" : n.textContent)}` : "";
    lines.push(`${"  ".repeat(depth)}${KIND[n.kind] ?? "?"}#${n.id} ${box}${text === ' ""' ? "" : text}`);
    for (const c of n.children) if (!(c instanceof TextLeaf)) walk(c, depth + 1);
  };
  walk(start, 0);
  return lines.join("\n");
}
