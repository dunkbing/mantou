// The README's example works as written (on a headless instance).
import { expect, test } from "bun:test";
import { Text, View, createSignal, mount } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

test("the README's toggle changes colour and label on press", () => {
  const h = new HeadlessCore({ width: 200, height: 100 });
  const [on, setOn] = createSignal(false);
  mount(h.ui, () => (
    <View style={{ width: 120, height: 48, borderRadius: 8, justifyContent: "center", backgroundColor: on() ? "#16a34a" : "#4b5563" }} onPress={() => setOn(!on())}>
      <Text style={{ color: "#ffffff", fontWeight: 600, textAlign: "center" }}>{on() ? "On" : "Off"}</Text>
    </View>
  ));
  expect(h.scene()).toContain("quad 0 0 120 48 #4b5563ff radius 8");
  const commits = h.stats().commits;
  h.press([60, 24]);
  expect(h.scene()).toContain("quad 0 0 120 48 #16a34aff radius 8");
  expect(h.stats().commits).toBe(commits + 1);
  expect(h.ui.lastCommitOps).toBe(2); // the colour and the label
  h.free();
});
