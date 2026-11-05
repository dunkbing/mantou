// onError and the app's crash reports (dunkbing/mantou#62).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { appError, crashDir, dispatchError, onError, writeReport, type AppError } from "./errors";

test("handlers see every error; one returning true handles it; removed handlers don't", () => {
  const seen: string[] = [];
  const off1 = onError((e) => void seen.push(`1 ${e.kind} ${e.message}`));
  const off2 = onError((e) => {
    seen.push(`2 ${e.kind}`);
    return e.kind === "error";
  });
  expect(dispatchError(appError("error", new TypeError("bad")))).toBe(true);
  expect(dispatchError(appError("rejection", "nope"))).toBe(false);
  off2();
  expect(dispatchError(appError("error", new Error("again")))).toBe(false);
  off1();
  expect(dispatchError(appError("error", new Error("none")))).toBe(false);
  expect(seen).toEqual(["1 error TypeError: bad", "2 error", "1 rejection nope", "2 rejection", "1 error Error: again"]);
});

test("a handler that throws doesn't stop the others", () => {
  const seen: AppError[] = [];
  const offs = [onError(() => { throw new Error("handler bug"); }), onError((e) => { seen.push(e); return true; })];
  const err = console.error;
  console.error = () => {};
  try {
    expect(dispatchError(appError("error", new Error("x")))).toBe(true);
  } finally {
    console.error = err;
    offs.forEach((f) => f());
  }
  expect(seen).toHaveLength(1);
});

test("a report has the message, the stack, the versions and the OS", () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-report-"));
  const before = process.env.MANTOU_CRASH_DIR;
  process.env.MANTOU_CRASH_DIR = join(dir, "crashes");
  try {
    expect(crashDir()).toBe(join(dir, "crashes"));
    const file = writeReport(appError("rejection", new RangeError("out of range")))!;
    expect(file.startsWith(join(dir, "crashes", "app-"))).toBe(true);
    const report = readFileSync(file, "utf8");
    expect(report).toStartWith("Mantou app unhandled rejection\n");
    expect(report).toContain("message: RangeError: out of range");
    expect(report).toContain(`Bun ${Bun.version}`);
    expect(report).toContain(`os: ${process.platform}-${process.arch}`);
    expect(report).toContain("errors.test.ts");
  } finally {
    if (before === undefined) delete process.env.MANTOU_CRASH_DIR;
    else process.env.MANTOU_CRASH_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
