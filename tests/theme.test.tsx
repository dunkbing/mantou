// Colour scheme and themes against the real core, headless: tokens follow the scheme, and only
// the nodes that read them are updated.
import { afterEach, expect, test } from "bun:test";
import { mount, View, defineTheme, useColorScheme, setColorScheme } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: HeadlessCore[] = [];
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((d) => d()); // the scheme is global: stop the old app reacting to it
  setColorScheme("system");
  open.forEach((h) => h.step()); // sends the release before the instance goes
  open.splice(0).forEach((h) => h.free());
});

const theme = defineTheme({ light: { bg: "#ffffff" }, dark: { bg: "#101010" } });

function app() {
  const h = new HeadlessCore();
  open.push(h);
  let scheme!: () => string;
  disposers.push(mount(h.ui, () => {
    scheme = useColorScheme();
    return <View style={{ width: 50, height: 50, backgroundColor: theme.bg }} />;
  }));
  h.step();
  return { h, scheme: () => scheme() };
}

const hasColour = (h: HeadlessCore, c: string) => h.scene().includes(c);

test("tokens follow the system scheme", () => {
  const { h, scheme } = app();
  expect(scheme()).toBe("light");
  expect(hasColour(h, "#ffffffff")).toBe(true);
  h.ui.dispatchWindowState(16, 0, 0); // the system goes dark
  h.step();
  expect(scheme()).toBe("dark");
  expect(hasColour(h, "#101010ff")).toBe(true);
});

test("setColorScheme overrides the system, and 'system' goes back", () => {
  const { h, scheme } = app();
  setColorScheme("dark");
  h.step();
  expect(scheme()).toBe("dark");
  expect(hasColour(h, "#101010ff")).toBe(true);
  setColorScheme("system");
  h.step();
  expect(scheme()).toBe("light");
});
