// The app's errors (dunkbing/mantou#62): uncaught errors and unhandled
// rejections in the app's Worker, and panics the core recovered from, go to
// the `onError` handlers. One nothing handles is a crash: a report goes in the
// data folder's `crashes` (the core writes its own there too) and the app quits.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ABI_VERSION } from "./ffi";
import { where } from "./paths";

export interface AppError {
  /** `error`: an uncaught error; `rejection`: an unhandled promise rejection; `core`: a panic the core recovered from. */
  kind: "error" | "rejection" | "core";
  message: string;
  /** The JS stack (not for `core`). */
  stack?: string;
  /** The report written for it, if one was: always for `core`; for the others, only when nothing handled it. */
  report?: string;
  /** What was thrown (not for `core`). */
  error?: unknown;
}

/** Return `true` when the app handled the error and runs on; otherwise an uncaught JS error quits the app. */
export type ErrorHandler = (e: AppError) => boolean | void;

const handlers = new Set<ErrorHandler>();

/**
 * Calls `handler` for the app's uncaught errors, unhandled rejections and the core's recovered
 * panics. Returning `true` keeps the app running after a JS error (a recovered core panic never
 * stops it). Returns a function that removes the handler.
 */
export function onError(handler: ErrorHandler): () => void {
  handlers.add(handler);
  return () => void handlers.delete(handler);
}

/** Gives `e` to the handlers; true when one handled it. A handler that throws is logged and skipped. */
export function dispatchError(e: AppError): boolean {
  let handled = false;
  for (const h of [...handlers]) {
    try {
      if (h(e) === true) handled = true;
    } catch (err) {
      console.error("mantou: an onError handler threw:", err);
    }
  }
  return handled;
}

/** Where crash reports go: `MANTOU_CRASH_DIR`, else the app's data folder's `crashes` (created with the first report). */
export function crashDir(): string {
  return process.env.MANTOU_CRASH_DIR || join(where("data"), "crashes");
}

/** An AppError for something thrown. */
export function appError(kind: "error" | "rejection", thrown: unknown): AppError {
  const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return { kind, message, stack: thrown instanceof Error ? thrown.stack : undefined, error: thrown };
}

/** Writes a report of `e` to the crash folder; returns its path, or undefined when it couldn't. */
export function writeReport(e: AppError): string | undefined {
  try {
    const dir = crashDir(), ms = Date.now();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `app-${ms}-${process.pid}.txt`);
    const report = [
      `Mantou app ${e.kind === "rejection" ? "unhandled rejection" : "uncaught error"}`,
      "",
      `message: ${e.message}`,
      `runtime: Bun ${Bun.version} (core ABI ${ABI_VERSION})`,
      `os: ${process.platform}-${process.arch}`,
      `time: ${ms} (ms since the Unix epoch)`,
      "",
      "stack:",
      e.stack ?? "(none)",
      "",
    ].join("\n");
    writeFileSync(file, report);
    return file;
  } catch {
    return undefined;
  }
}
