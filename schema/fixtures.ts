// Op batches committed as golden fixtures (schema/fixtures/*.bin + *.json). The
// Rust decoder's tests read the same files, so both sides must agree on every op.
import { OpEncoder } from "../runtime/encoder";

export function fixtureScenarios(): Record<string, Uint8Array> {
  const e = new OpEncoder();
  // Every op once, and every value kind.
  e.create(1, 1);
  e.create(2, 1);
  e.create(3, 1);
  e.styleDef(1, [["width", 24], ["height", "50%"], ["backgroundColor", "#f59e0b"], ["flexDirection", "row"], ["opacity", 0.5]]);
  e.style(1, "flexDirection", "column");
  e.style(1, "paddingTop", 12);
  e.style(1, "width", "auto");
  e.style(1, "backgroundColor", [16, 32, 48, 0.5]);
  e.style(1, "flexGrow", 1.25);
  e.styleUse(2, 1);
  e.styleUse(3, 1);
  e.insert(1, 2, 0);
  e.insert(1, 3, 2);
  e.listen(3, 1);
  e.setRoot(1);
  e.clearColor(0.1, 0.2, 0.3, 1);
  e.title("Mantou ✓");
  e.styleReset(1, "width");
  e.remove(1, 2);
  e.release(2);
  e.create(4, 2);
  e.style(4, "fontSize", 15);
  e.style(4, "color", "#111827");
  e.style(4, "textAlign", "center");
  e.style(4, "maxLines", 1);
  e.style(4, "overflow", "hidden");
  e.text(4, "Héllo, wörld ✉");
  e.insert(1, 4, 0);
  e.create(5, 3);
  e.inputOptions(5, 1, 280);
  e.placeholder(5, "Search mail");
  e.value(5, 0, "from:ana");
  e.style(5, "caretColor", "#2563eb");
  e.insert(1, 5, 0);
  e.focus(5);
  e.value(5, 3, "");
  e.focus(0);
  e.focusScope(1, 3);
  e.style(3, "overflow", "scroll");
  e.style(3, "scrollbar", "none");
  e.scrollTo(3, 0, 120, 0);
  e.scrollTo(3, 0, -40, 1);
  e.scrollIntoView(4, 0);
  e.fontFamily(1, "Lucide, monospace");
  e.style(4, "fontFamily", 1);
  e.font(new Uint8Array([0, 1, 0, 0, 0, 7]));
  const basic = e.take();
  return { basic };
}
