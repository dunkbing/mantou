// What `<Canvas draw={(g) => …}>` hands to `draw`: a recorder of drawing commands, sent to the core as one CANVAS op.
import { CanvasCmd } from "./gen/protocol";
import type { Color } from "./gen/protocol";
import { f32bits, parseColor } from "./style";

/**
 * Draws in logical px from the canvas's top left. Shapes come out in the order drawn, over the view's background,
 * cut to its box. Colours are hex strings (`"#2563eb"`, `"#2563eb80"` for half see-through) or `[r, g, b, a]` with `a` from 0 to 1.
 */
export class CanvasContext {
  /** @internal The commands, as the wire wants them. */
  readonly words: number[] = [];

  private put(cmd: number, nums: number[], color: Color) {
    for (const n of nums) if (!Number.isFinite(n)) return this; // a NaN from a bad calculation draws nothing
    this.words.push(cmd, ...nums.map(f32bits), parseColor(color));
    return this;
  }

  /** A filled rectangle. */
  fillRect(x: number, y: number, w: number, h: number, color: Color) {
    return this.put(CanvasCmd.FillRect, [x, y, w, h], color);
  }

  /** A rectangle's outline, `width` px wide inside its edge. */
  strokeRect(x: number, y: number, w: number, h: number, color: Color, width = 1) {
    return this.put(CanvasCmd.StrokeRect, [x, y, w, h, width], color);
  }

  /** A filled rectangle with rounded corners. */
  roundRect(x: number, y: number, w: number, h: number, radius: number, color: Color) {
    return this.put(CanvasCmd.RoundRect, [x, y, w, h, radius], color);
  }

  /** A filled circle. */
  circle(cx: number, cy: number, r: number, color: Color) {
    return this.put(CanvasCmd.Circle, [cx, cy, r], color);
  }

  /** A circle's outline, `width` px wide inside its edge. */
  strokeCircle(cx: number, cy: number, r: number, color: Color, width = 1) {
    return this.put(CanvasCmd.StrokeCircle, [cx, cy, r, width], color);
  }

  /** A straight line with flat ends. */
  line(x0: number, y0: number, x1: number, y1: number, color: Color, width = 1) {
    return this.put(CanvasCmd.Line, [x0, y0, x1, y1, width], color);
  }

  /**
   * The region between a polyline and the horizontal line at `baseline` (an area chart's fill). Points go left to
   * right (x rising); where the line crosses the baseline the fill switches sides.
   */
  area(points: readonly (readonly [number, number])[], baseline: number, color: Color) {
    if (!Number.isFinite(baseline) || points.length < 2 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return this;
    this.words.push(CanvasCmd.Area, f32bits(baseline), parseColor(color), points.length);
    for (const [x, y] of points) this.words.push(f32bits(x), f32bits(y));
    return this;
  }

  /** Lines through the points, one after the other (square joins: round them with small circles if the width is large). */
  polyline(points: readonly (readonly [number, number])[], color: Color, width = 1) {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], color, width);
    return this;
  }
}
