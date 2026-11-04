import { expect, test } from "bun:test";
import { View, defineStyle, mount } from "mantou-ui";
import { MockCore } from "./mock";

test("boxShadow sets the five shadow properties; none removes the shadow", async () => {
  const core = new MockCore();
  const node = core.ui.view({ boxShadow: { y: 4, blur: 12, color: "#00000040" } });
  await core.settle();
  expect(core.lastCommit.filter((o) => o.op === "STYLE").map((o) => [o.prop, o.value])).toEqual([
    ["shadowX", 0], ["shadowY", 4], ["shadowBlur", 12], ["shadowSpread", 0], ["shadowColor", "#00000040"],
  ]);
  node.style({ boxShadow: "none" });
  await core.settle();
  expect(core.lastCommit.map((o) => [o.prop, o.value])).toEqual([["shadowY", 0], ["shadowBlur", 0], ["shadowColor", "#00000000"]]);
});

test("a shared style with a shadow is defined once", async () => {
  const core = new MockCore();
  const card = defineStyle({ boxShadow: { y: 2, blur: 4, color: "#0003" } });
  mount(core.ui, () => <View>{[1, 2, 3].map(() => <View style={card} />)}</View>);
  await core.settle();
  expect(core.commits[0].filter((o) => o.op === "STYLE_DEF").length).toBe(1);
});
