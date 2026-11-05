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

  /** The polygon the points make (closed for you), filled; where it crosses itself, even-odd. */
  fillPath(points: readonly (readonly [number, number])[], color: Color) {
    if (points.length < 3 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return this;
    this.words.push(CanvasCmd.FillPoly, parseColor(color), points.length);
    for (const [x, y] of points) this.words.push(f32bits(x), f32bits(y));
    return this;
  }

  /** Fills every subpath of a `Path`. */
  fill(path: Path, color: Color) {
    for (const sub of path.subpaths) this.fillPath(sub, color);
    return this;
  }

  /** Strokes a `Path` with lines `width` wide; joins are round (a circle at each corner) when `width` is over 2. */
  stroke(path: Path, color: Color, width = 1) {
    path.subpaths.forEach((sub, i) => {
      const pts = path.closed[i] ? [...sub, sub[0]] : sub;
      this.polyline(pts, color, width);
      if (width > 2) for (let j = 1; j < pts.length - 1 + (path.closed[i] ? 1 : 0); j++) this.circle(pts[j % pts.length][0], pts[j % pts.length][1], width / 2, color);
    });
    return this;
  }

  /** Lines through the points, one after the other (square joins: round them with small circles if the width is large). */
  polyline(points: readonly (readonly [number, number])[], color: Color, width = 1) {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], color, width);
    return this;
  }
}

/** The most a curve may stray from its flattened lines, in px. */
const TOLERANCE = 0.2;

/**
 * An outline built from lines, curves and arcs, then `fill`ed or `stroke`d on a canvas. Curves are flattened into lines
 * when added. Angles are radians, clockwise from the right (the y axis points down).
 */
export class Path {
  /** @internal */
  readonly subpaths: [number, number][][] = [];
  /** @internal */
  readonly closed: boolean[] = [];

  private get cur() {
    return this.subpaths[this.subpaths.length - 1];
  }

  moveTo(x: number, y: number) {
    this.subpaths.push([[x, y]]);
    this.closed.push(false);
    return this;
  }

  lineTo(x: number, y: number) {
    if (!this.subpaths.length) return this.moveTo(x, y);
    this.cur.push([x, y]);
    return this;
  }

  /** A quadratic curve to (x, y) with one control point. */
  quadTo(cx: number, cy: number, x: number, y: number) {
    const [x0, y0] = this.last();
    const n = Math.max(4, Math.min(64, Math.ceil(Math.sqrt(Math.hypot(x0 - 2 * cx + x, y0 - 2 * cy + y) / (4 * TOLERANCE)) * 2)));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
    return this;
  }

  /** A cubic Bézier curve to (x, y) with two control points. */
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const [x0, y0] = this.last();
    const dev = Math.max(Math.hypot(x0 - 2 * c1x + c2x, y0 - 2 * c1y + c2y), Math.hypot(c1x - 2 * c2x + x, c1y - 2 * c2y + y));
    const n = Math.max(4, Math.min(64, Math.ceil(Math.sqrt((3 * dev) / (4 * TOLERANCE)))));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
    }
    return this;
  }

  /**
   * An arc of the circle at (cx, cy), from angle `from` to `to` (to < from goes the other way round). It starts with
   * a line from where the path is, or begins the path.
   */
  arc(cx: number, cy: number, r: number, from: number, to: number) {
    const sweep = to - from;
    const step = r > TOLERANCE ? 2 * Math.acos(1 - TOLERANCE / r) : Math.PI / 2;
    const n = Math.max(1, Math.min(720, Math.ceil(Math.abs(sweep) / step)));
    for (let i = 0; i <= n; i++) {
      const a = from + (sweep * i) / n;
      this.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return this;
  }

  /** Ends the subpath with a line back to its start (for `stroke`; `fill` closes every subpath anyway). */
  close() {
    if (this.subpaths.length) this.closed[this.closed.length - 1] = true;
    return this;
  }

  private last(): [number, number] {
    const c = this.cur;
    return c ? c[c.length - 1] : [0, 0];
  }
}
