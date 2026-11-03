// Decodes op batches into readable objects: for the mock core, fixtures and
// tracing. The Rust decoder (mantou-tree) must agree with it byte for byte.
import { OpName, StyleProp, StylePropByCode, Unit } from "./gen/protocol";
import { bitsf32, formatColor } from "./style";

export type DecodedOp = { op: string } & Record<string, unknown>;

function decodeValue(prop: string, w: Uint32Array, i: number): [unknown, number] {
  const def = StyleProp[prop as keyof typeof StyleProp];
  switch (def.kind) {
    case "f32": return [bitsf32(w[i]), 1];
    case "color": return [formatColor(w[i]), 1];
    case "length": {
      const unit = w[i], v = bitsf32(w[i + 1]);
      return [unit === Unit.auto ? "auto" : unit === Unit.percent ? `${v}%` : v, 2];
    }
    case "enum": return [(def as { values: readonly string[] }).values[w[i]] ?? `#${w[i]}`, 1];
  }
}

export function decodeOps(bytes: Uint8Array): DecodedOp[] {
  if (bytes.byteLength % 4) throw new Error("op batch length is not a multiple of 4");
  const w = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const out: DecodedOp[] = [];
  let i = 0;
  while (i < w.length) {
    const code = w[i] & 0xffff, n = w[i] >>> 16, a = i + 1;
    if (a + n > w.length) throw new Error(`op at word ${i} overruns the batch`);
    const name = OpName[code] ?? `UNKNOWN_${code}`;
    let o: DecodedOp;
    switch (name) {
      case "CREATE": o = { op: name, id: w[a], kind: w[a + 1] }; break;
      case "INSERT": o = { op: name, parent: w[a], child: w[a + 1], before: w[a + 2] }; break;
      case "REMOVE": o = { op: name, parent: w[a], child: w[a + 1] }; break;
      case "RELEASE": case "SET_ROOT": o = { op: name, id: w[a] }; break;
      case "STYLE": {
        const prop = StylePropByCode[w[a + 1]];
        o = { op: name, id: w[a], prop, value: decodeValue(prop, w, a + 2)[0] };
        break;
      }
      case "STYLE_RESET": o = { op: name, id: w[a], prop: StylePropByCode[w[a + 1]] }; break;
      case "STYLE_DEF": {
        const props: [string, unknown][] = [];
        let j = a + 2;
        for (let k = 0; k < w[a + 1]; k++) {
          const prop = StylePropByCode[w[j]];
          const [v, used] = decodeValue(prop, w, j + 1);
          props.push([prop, v]);
          j += 1 + used;
        }
        o = { op: name, styleId: w[a], props };
        break;
      }
      case "STYLE_USE": o = { op: name, id: w[a], styleId: w[a + 1] }; break;
      case "LISTEN": o = { op: name, id: w[a], mask: w[a + 1] }; break;
      case "CLEAR_COLOR": o = { op: name, r: bitsf32(w[a]), g: bitsf32(w[a + 1]), b: bitsf32(w[a + 2]), a: bitsf32(w[a + 3]) }; break;
      case "TITLE": {
        const len = w[a];
        o = { op: name, title: new TextDecoder().decode(new Uint8Array(w.buffer, (a + 1) * 4, len)) };
        break;
      }
      default: o = { op: name, words: Array.from(w.subarray(a, a + n)) };
    }
    out.push(o);
    i = a + n;
  }
  return out;
}
