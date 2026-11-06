// Typing into a multiline Input holding 5,000 characters: each key is edited and laid out in the core.
import { Input, View, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";
import { delta, report, summary, time } from "./lib";

const text = "The quick brown fox jumps over the lazy dog. ".repeat(110).slice(0, 5000);
const h = new HeadlessCore({ width: 600, height: 400 });
mount(h.ui, () => (
  <View style={{ padding: 10, flexGrow: 1 }}>
    <Input multiline autoFocus defaultValue={text} style={{ flexGrow: 1, fontSize: 14 }} />
  </View>
));
h.step();
h.key("End", { primary: true });
const before = h.stats();
const keys = time((i) => h.type("abcdefghij"[i % 10]), 200, 10);
const d = delta(before, h.stats());
const k = summary(keys);
report({
  characters: text.length,
  "key median ms": k.median,
  "key p95 ms": k.p95,
  "layout ms/key": d.layoutMicros / 1000 / 210,
  "scene ms/key": d.sceneMicros / 1000 / 210,
  "commits/key": d.commits / 210,
});
h.free();
