// A mock core for tests (design §12.4): records every committed batch,
// decoded, and lets tests deliver presses. No FFI, no window.
import { decodeOps, type DecodedOp } from "./decode";
import { Ui } from "./ui";

export class MockCore {
  readonly commits: DecodedOp[][] = [];
  readonly ui = new Ui({ commit: (bytes) => this.commits.push(decodeOps(bytes)) });

  /** Waits for the current turn's commit (they happen in a microtask). */
  async settle() {
    await Promise.resolve();
  }

  get lastCommit(): DecodedOp[] {
    return this.commits.at(-1) ?? [];
  }

  /** The user changes an Input's text to `text`, as the core would report it. */
  change(nodeId: number, text: string) {
    const node = this.ui.nodes.get(nodeId);
    this.ui.dispatchInput({ type: "textChanged", target: nodeId, rev: (node?.rev ?? 0) + 1, text });
  }

  /** Enter in an Input. */
  submit(nodeId: number) {
    this.ui.dispatchInput({ type: "submit", target: nodeId });
  }

  /** An Input gets (or, with `false`, loses) the focus. */
  focus(nodeId: number, focused = true) {
    this.ui.dispatchInput({ type: focused ? "focus" : "blur", target: nodeId });
  }

  /** The core laid a node out at a new box. */
  layout(nodeId: number, rect: { x: number; y: number; width: number; height: number }) {
    this.ui.dispatchLayout(nodeId, rect);
  }

  /** The core decoded an Image's source (or failed to). */
  image(nodeId: number, result: { width: number; height: number } | { error: string }) {
    this.ui.dispatchImage(nodeId, result);
  }

  /** The core scrolled a scroll view to an offset. */
  scroll(nodeId: number, x: number, y: number) {
    this.ui.dispatchScroll(nodeId, x, y);
  }

  /** An animation ended (its id is the ANIMATE op's `animation`). */
  animationEnd(animation: number) {
    this.ui.dispatchAnimationEnd(animation);
  }

  /** The window resized (logical px). */
  resize(width: number, height: number, scale = 1) {
    this.ui.dispatchResize(width, height, scale);
  }

  /** Delivers a press as the core would (target, then bubbling). */
  press(nodeId: number, x = 0, y = 0) {
    this.ui.dispatchPress(nodeId, x, y);
  }
}
