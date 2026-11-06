import { expect, test } from "bun:test";
import { parseGnomeScheme, parsePortalScheme } from "./linux-scheme";

test("the portal's color-scheme, from a Read answer or a SettingChanged signal", () => {
  expect(parsePortalScheme("(<<uint32 1>>,)")).toBe("dark");
  expect(parsePortalScheme("(<uint32 2>,)")).toBe("light");
  expect(parsePortalScheme("(<<uint32 0>>,)")).toBeNull();
  expect(parsePortalScheme("/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.freedesktop.appearance', 'color-scheme', <uint32 1>)")).toBe("dark");
});

test("GNOME's settings as a fallback", () => {
  expect(parseGnomeScheme("'prefer-dark'", "'Adwaita'")).toBe("dark");
  expect(parseGnomeScheme("'default'", "'Yaru-dark'")).toBe("dark");
  expect(parseGnomeScheme("'default'", "'Adwaita'")).toBe("light");
  expect(parseGnomeScheme(null, null)).toBeNull();
});
