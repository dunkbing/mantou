import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { paths } from "mantou-ui";

test("directories are per app, created on first read", () => {
  paths.setApp("mantou-paths-test");
  const c = paths.config;
  expect(c.endsWith("mantou-paths-test")).toBe(true);
  expect(existsSync(c)).toBe(true);
  expect(paths.cache).not.toBe(paths.temp);
  for (const p of [c, paths.data, paths.cache, paths.temp]) rmSync(p, { recursive: true, force: true });
});
