// Encodes ops into one buffer per commit (design §8.1). Each op is
// `code | operandWords << 16` followed by its operands, all little-endian u32.
import { Op, StyleProp, type StylePropName } from "./gen/protocol";
import { encodeValue, f32bits } from "./style";

const utf8 = new TextEncoder();

/** A string operand: its UTF-8 byte length, then the bytes padded to words. */
function stringWords(s: string): number[] {
  const bytes = utf8.encode(s);
  const words = new Uint32Array(Math.ceil(bytes.length / 4));
  new Uint8Array(words.buffer).set(bytes);
  return [bytes.length, ...words];
}

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
  title(s: string) { this.op(Op.TITLE, stringWords(s)); }

  text(id: number, s: string) { this.op(Op.TEXT, [id, ...stringWords(s)]); }
  value(id: number, rev: number, s: string) { this.op(Op.VALUE, [id, rev, ...stringWords(s)]); }
  placeholder(id: number, s: string) { this.op(Op.PLACEHOLDER, [id, ...stringWords(s)]); }
  inputOptions(id: number, flags: number, maxLength: number) { this.op(Op.INPUT_OPTIONS, [id, flags, maxLength]); }
  focus(id: number) { this.op(Op.FOCUS, [id]); }
  imagePath(id: number, path: string) { this.op(Op.IMAGE_PATH, [id, ...stringWords(path)]); }
  imageData(id: number, data: Uint8Array) {
    const words = new Uint32Array(Math.ceil(data.length / 4));
    new Uint8Array(words.buffer).set(data);
    this.op(Op.IMAGE_DATA, [id, data.length, ...words]);
  }
  font(data: Uint8Array) {
    const words = new Uint32Array(Math.ceil(data.length / 4));
    new Uint8Array(words.buffer).set(data);
    this.op(Op.FONT, [data.length, ...words]);
  }
  fontFamily(family: number, names: string) { this.op(Op.FONT_FAMILY, [family, ...stringWords(names)]); }
  windowSize(width: number, height: number) { this.op(Op.WINDOW_SIZE, [f32bits(width), f32bits(height)]); }
  windowLimits(minW: number, minH: number, maxW: number, maxH: number, flags: number) {
    this.op(Op.WINDOW_LIMITS, [f32bits(minW), f32bits(minH), f32bits(maxW), f32bits(maxH), flags]);
  }
  focusScope(id: number, flags: number) { this.op(Op.FOCUS_SCOPE, [id, flags]); }
  scrollTo(id: number, x: number, y: number, flags: number) { this.op(Op.SCROLL_TO, [id, f32bits(x), f32bits(y), flags]); }
  scrollIntoView(id: number, block: number) { this.op(Op.SCROLL_INTO_VIEW, [id, block]); }

  get empty() { return this.len === 0; }

  /** Returns the batch (a copy) and starts a new one. */
  take(): Uint8Array {
    const out = new Uint8Array(this.buf.slice(0, this.len * 4));
    this.len = 0;
    this.ops = 0;
    return out;
  }
}
