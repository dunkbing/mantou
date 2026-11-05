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
    case "family": return [w[i], 1];
  }
}

/** A string operand at word `i`: its byte length, then the bytes. */
function str(w: Uint32Array, i: number): string {
  return new TextDecoder().decode(new Uint8Array(w.buffer, (i + 1) * 4, w[i]));
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
      case "TITLE": o = { op: name, title: str(w, a) }; break;
      case "INPUT_ALLOW": o = { op: name, id: w[a], allow: str(w, a + 1) }; break;
      case "TEXT": case "PLACEHOLDER": o = { op: name, id: w[a], text: str(w, a + 1) }; break;
      case "ACCESS": o = { op: name, id: w[a], role: w[a + 1], flags: w[a + 2], label: str(w, a + 3) }; break;
      case "VALUE": o = { op: name, id: w[a], rev: w[a + 1], text: str(w, a + 2) }; break;
      case "INPUT_OPTIONS": o = { op: name, id: w[a], flags: w[a + 1], maxLength: w[a + 2] }; break;
      case "FOCUS": o = { op: name, id: w[a] }; break;
      case "FONT": o = { op: name, bytes: w[a] }; break;
      case "IMAGE_PATH": o = { op: name, id: w[a], path: str(w, a + 1) }; break;
      case "IMAGE_DATA": o = { op: name, id: w[a], bytes: w[a + 1] }; break;
      case "FONT_FAMILY": o = { op: name, family: w[a], names: str(w, a + 1) }; break;
      case "TRANSITION": o = { op: name, id: w[a], prop: StylePropByCode[w[a + 1]], duration: bitsf32(w[a + 2]), easing: w[a + 3] }; break;
      case "TEXT_RUNS": {
        const runs: { length: number; spans: number[] }[] = [];
        for (let j = a + 1; j + 1 < a + n; j += 2 + w[j + 1]) runs.push({ length: w[j], spans: Array.from(w.subarray(j + 2, j + 2 + w[j + 1])) });
        o = { op: name, id: w[a], runs };
        break;
      }
      case "KEYFRAMES": o = { op: name, id: w[a], animation: w[a + 1], values: w.slice(a + 2, a + n) }; break;
      case "ANIMATE": o = { op: name, id: w[a], animation: w[a + 1], prop: StylePropByCode[w[a + 2]], from: w[a + 3], to: w[a + 4], duration: bitsf32(w[a + 5]), easing: w[a + 6], iterations: bitsf32(w[a + 7]), flags: w[a + 8] }; break;
      case "SELECT": o = { op: name, id: w[a], anchor: w[a + 1], focus: w[a + 2] }; break;
      case "WINDOW_SIZE": o = { op: name, width: bitsf32(w[a]), height: bitsf32(w[a + 1]) }; break;
      case "WINDOW_LIMITS": o = { op: name, minWidth: bitsf32(w[a]), minHeight: bitsf32(w[a + 1]), maxWidth: bitsf32(w[a + 2]), maxHeight: bitsf32(w[a + 3]), flags: w[a + 4] }; break;
      case "FOCUSABLE": o = { op: name, id: w[a], flags: w[a + 1], order: w[a + 2] }; break;
      case "FOCUS_SCOPE": o = { op: name, id: w[a], flags: w[a + 1] }; break;
      case "SCROLL_TO": o = { op: name, id: w[a], x: bitsf32(w[a + 1]), y: bitsf32(w[a + 2]), flags: w[a + 3] }; break;
      case "SCROLL_INTO_VIEW": o = { op: name, id: w[a], block: w[a + 1] }; break;
      default: o = { op: name, words: Array.from(w.subarray(a, a + n)) };
    }
    out.push(o);
    i = a + n;
  }
  return out;
}
