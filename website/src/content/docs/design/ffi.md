---
title: "FFI conventions"
description: "Rules for calls, pointer lifetimes, callbacks and version checks across bun:ffi."
---

## 11. FFI conventions and Bun-specific rules

- **Pass scalars, pointers and lengths only.** Encode everything else into buffers.
- **Keep the call count low:** one call per commit and one per batch of events. Never one call per node or style.
- **Pointer lifetimes:**
  - Op buffers belong to JS and must stay alive for the length of the `mt_commit` call. The core copies anything it keeps.
  - The pointer returned by `mt_take_events` is valid until the next call.
- **Callbacks:** only the `wake` callback crosses from native to JS, and it is `threadsafe: true`. No other native-to-JS callbacks exist.
- **Version checks:** `mt_abi_version()` is checked at startup, and the op format carries `version`. A mismatch is a fatal error with a clear message.
- **Experimental APIs:** Bun marks `bun:ffi` and `Worker` experimental. Pin the Bun version per release and run CI on all three OSes.
