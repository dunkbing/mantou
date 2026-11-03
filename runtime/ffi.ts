// bun:ffi bindings to the native core (core/crates/mantou-ffi). Both the main
// thread and the Worker dlopen the same library and share its state.
import { dlopen, suffix } from "bun:ffi";
import { join } from "node:path";

export const ABI_VERSION = 2;

export const symbols = {
  mt_abi_version: { args: [], returns: "u32" },
  mt_run: { args: ["ptr", "u32"], returns: "i32" },
  mt_set_wake: { args: ["function"], returns: "void" },
  mt_commit: { args: ["ptr", "u32"], returns: "i32" },
  mt_take_events: { args: ["ptr", "u32"], returns: "u32" },
  mt_stats: { args: ["ptr", "u32"], returns: "u32" },
  mt_info: { args: ["ptr", "u32"], returns: "u32" },
  mt_test_resize: { args: ["u32", "u32", "u32", "u32", "u32", "u32"], returns: "void" },
  mt_test_pointer: { args: ["u32", "f32", "f32"], returns: "void" },
  mt_test_node_rect: { args: ["u32", "ptr"], returns: "i32" },
  mt_quit: { args: ["i32"], returns: "void" },
} as const;

export function libPath(): string {
  if (process.env.MANTOU_CORE) return process.env.MANTOU_CORE;
  const file = process.platform === "win32" ? `mantou_ffi.${suffix}` : `libmantou_ffi.${suffix}`;
  return join(import.meta.dir, "..", "core", "target", "release", file);
}

export function openCore() {
  const lib = dlopen(libPath(), symbols);
  const v = lib.symbols.mt_abi_version();
  if (v !== ABI_VERSION) {
    throw new Error(`mantou: native core ABI ${v}, runtime expects ${ABI_VERSION} (${libPath()})`);
  }
  return lib;
}

export type CoreLib = ReturnType<typeof openCore>;
