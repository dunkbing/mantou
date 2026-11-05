// The widgets' theme: light by default, switchable at runtime, per-widget style still wins.
import { afterEach, expect, test } from "bun:test";
import { Button, Progress, mount, setTheme, theme, lightTheme, darkTheme } from "mantou-ui";
import { HeadlessCore } from "../runtime/headless";

const open: { h: HeadlessCore; stop: () => void }[] = [];
afterEach(() => {
  open.splice(0).forEach(({ h, stop }) => (stop(), h.step(), h.free()));
  setTheme("light");
});

function app() {
  const h = new HeadlessCore();
  const stop = mount(h.ui, () => (
    <>
      <Progress value={0.5} />
      <Button style={{ backgroundColor: "#ff0000" }}>x</Button>
    </>
  ));
  open.push({ h, stop });
  h.step();
  return h;
}

test("light by default, dark and custom themes repaint the widgets", () => {
  const h = app();
  expect(theme.divider).toBe(lightTheme.divider);
  const hex = (c: string) => c.replace("#", "").toLowerCase();
  expect(h.scene().toLowerCase()).toContain(hex(lightTheme.divider));
  setTheme("dark");
  h.step();
  expect(theme.divider).toBe(darkTheme.divider);
  expect(h.scene().toLowerCase()).toContain(hex(darkTheme.divider));
  expect(h.scene().toLowerCase()).not.toContain(hex(lightTheme.divider));
  setTheme({ ...darkTheme, divider: "#123456" });
  h.step();
  expect(h.scene().toLowerCase()).toContain("123456");
  expect(h.scene().toLowerCase()).toContain("ff0000"); // the widget's own style still wins
});
