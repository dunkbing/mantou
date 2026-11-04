// A theme made before any window exists follows the system once one does, without the app asking
// for useColorScheme (dunkbing/mantou#54), and shared styles can follow a theme (#53).
import { afterEach, expect, test } from "bun:test";
import { mount, View, defineStyle, defineTheme, setColorScheme } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const T = defineTheme({ light: { bg: "#ffffff" }, dark: { bg: "#101010" } }); // at module load, as an app's theme file does
const shared = defineStyle(() => ({ width: 50, height: 50, backgroundColor: T.bg }));

let h: HeadlessCore;
let stop: () => void;
afterEach(() => {
  stop();
  setColorScheme("system");
  h.step();
  h.free();
});

test("a theme defined before the window follows the system, and so does a shared style made from it", () => {
  h = new HeadlessCore();
  stop = mount(h.ui, () => (
    <View>
      <View style={shared} />
      <View style={{ width: 50, height: 50, backgroundColor: T.bg }} />
    </View>
  ));
  h.step();
  const light = h.scene().split("\n").filter((l) => l.includes("#ffffffff")).length;
  expect(light).toBe(2);
  h.ui.dispatchWindowState(16, 0, 0); // the system goes dark
  h.step();
  const dark = h.scene().split("\n").filter((l) => l.includes("#101010ff")).length;
  expect(dark).toBe(2);
});

test("setColorScheme reaches a shared style too", () => {
  h = new HeadlessCore();
  stop = mount(h.ui, () => <View style={shared} />);
  h.step();
  setColorScheme("dark");
  h.step();
  expect(h.scene()).toContain("#101010ff");
});
