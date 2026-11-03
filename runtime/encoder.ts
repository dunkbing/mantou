// Encodes ops into one buffer per commit (design §8.1). Each op is
// `code | operandWords << 16` followed by its operands, all little-endian u32.
import { Op, StyleProp, type StylePropName } from "./gen/protocol";
import { encodeValue, f32bits } from "./style";

export class OpEncoder {
  private buf = new ArrayBuffer(4096);
  private u32 = new Uint32Array(this.buf);
  private len = 0; // words
  /** Ops in the current batch. */
  ops = 0;

  private reserve(words: number) {
    if (this.len + words <= this.u32.length) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, (this.len + words) * 4));
    new Uint32Array(next).set(this.u32.subarray(0, this.len));
    this.buf = next;
    this.u32 = new Uint32Array(next);
  }

  private op(code: number, operands: readonly number[]) {
    this.reserve(1 + operands.length);
    this.u32[this.len++] = (code | (operands.length << 16)) >>> 0;
    for (const w of operands) this.u32[this.len++] = w >>> 0;
    this.ops++;
  }

  create(id: number, kind: number) { this.op(Op.CREATE, [id, kind]); }
  insert(parent: number, child: number, before = 0) { this.op(Op.INSERT, [parent, child, before]); }
  remove(parent: number, child: number) { this.op(Op.REMOVE, [parent, child]); }
  release(id: number) { this.op(Op.RELEASE, [id]); }
  style(id: number, prop: StylePropName, value: unknown) {
    this.op(Op.STYLE, [id, StyleProp[prop].code, ...encodeValue(prop, value)]);
  }
  styleReset(id: number, prop: StylePropName) { this.op(Op.STYLE_RESET, [id, StyleProp[prop].code]); }
  styleDef(styleId: number, props: Iterable<[StylePropName, unknown]>) {
    const words: number[] = [];
    let n = 0;
    for (const [p, v] of props) {
      words.push(StyleProp[p].code, ...encodeValue(p, v));
      n++;
    }
    this.op(Op.STYLE_DEF, [styleId, n, ...words]);
  }
  styleUse(id: number, styleId: number) { this.op(Op.STYLE_USE, [id, styleId]); }
  listen(id: number, mask: number) { this.op(Op.LISTEN, [id, mask]); }
  setRoot(id: number) { this.op(Op.SET_ROOT, [id]); }
  clearColor(r: number, g: number, b: number, a: number) {
    this.op(Op.CLEAR_COLOR, [f32bits(r), f32bits(g), f32bits(b), f32bits(a)]);
  }
  title(s: string) {
    const bytes = new TextEncoder().encode(s);
    const words = new Uint32Array(Math.ceil(bytes.length / 4));
    new Uint8Array(words.buffer).set(bytes);
    this.op(Op.TITLE, [bytes.length, ...words]);
  }

  get empty() { return this.len === 0; }

  /** Returns the batch (a copy) and starts a new one. */
  take(): Uint8Array {
    const out = new Uint8Array(this.buf.slice(0, this.len * 4));
    this.len = 0;
    this.ops = 0;
    return out;
  }
}
