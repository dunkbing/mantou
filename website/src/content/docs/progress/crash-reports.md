---
title: Errors and crash reports
description: "onError for uncaught errors, unhandled rejections and panics the core recovers from; report files for crashes."
---

[#62](https://github.com/dunkbing/mantou/issues/62). The main thread runs no app JS, so nothing there notices an error in the app's Worker. The Worker catches it itself (`process.on("uncaughtException" | "unhandledRejection")`; Bun ends a Worker after its `error` event even when the event is prevented) and gives it to the `onError` handlers. One that no handler takes (`return true`) is a crash: a report goes in `<data>/crashes/app-<time>-<pid>.txt` and the app quits with exit code 70.

The core installs a panic hook when the app starts (`mt_set_crash_dir`, ABI 15). A panic on any thread writes `<data>/crashes/core-<time>-<pid>.txt`: the message, where, the thread, the core's version and ABI, the OS, and a backtrace. The hook only `try_lock`s, so it can't deadlock on a lock the panicking code holds. Every C ABI call runs under `guard`; when it catches a panic, the call is dropped and the core sends a `CORE_ERROR` event (`{ message, report }`) to the instance the call was for, after the stack has unwound. JS hands it to `onError` as `kind: "core"`.

| What | Where it's tested |
|---|---|
| A recovered panic: a report, `onError`, the instance still lays out and draws | `tests/crash.test.tsx` (`mt_test_panic`) |
| No crash folder: `onError` still hears it, with no report | `tests/crash.test.tsx` |
| Handlers, removal, a handler that throws; a JS report's contents | `runtime/errors.test.ts` |
| In a window: a throw in a timer, a rejection, a throw in an event handler, a core panic; handled, the window draws on | self-test, check 13 |

Not done: a panic outside `guard` (on a render or loader thread) writes a report but nothing tells JS, and an `abort` (a double panic, a stack overflow, a native crash in a driver) leaves no report.
