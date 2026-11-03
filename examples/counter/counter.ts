// The M1 counter: no text yet (that's M3), so the count is shown as squares and
// in the window title. Press + to add a square, − to remove one, ⟲ to clear.
// It takes a Ui, so the same code runs in the window (main.ts) and against the
// mock core in tests (counter.test.ts).
import type { Node, Ui } from "../../runtime/ui";

export interface Counter {
  plus: Node;
  minus: Node;
  reset: Node;
  board: Node;
  count(): number;
}

export function counter(ui: Ui): Counter {
  const button = ui.defineStyle({ width: 88, height: 44 });
  const dot = ui.defineStyle({ width: 28, height: 28, backgroundColor: "#f59e0b" });

  const root = ui.view({ padding: 24, gap: 16, backgroundColor: "#111318" });
  const toolbar = ui.view({ flexDirection: "row", gap: 12 });
  const plus = ui.view(button, { backgroundColor: "#16a34a" });
  const minus = ui.view(button, { backgroundColor: "#dc2626" });
  const reset = ui.view(button, { backgroundColor: "#4b5563" });
  const board = ui.view({ flexGrow: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, backgroundColor: "#1f2430" });

  toolbar.append(plus).append(minus).append(reset);
  root.append(toolbar).append(board);
  ui.setRoot(root);

  const dots: Node[] = [];
  const show = () => ui.title(`Mantou counter · ${dots.length}`);
  show();

  plus.onPress(() => {
    const d = ui.view(dot);
    board.append(d);
    dots.push(d);
    show();
  });
  minus.onPress(() => {
    dots.pop()?.release();
    show();
  });
  reset.onPress(() => {
    for (const d of dots.splice(0)) d.release();
    show();
  });

  return { plus, minus, reset, board, count: () => dots.length };
}
