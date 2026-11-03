// bun:ffi bindings to the native core (core/crates/mantou-ffi). Both the main
// thread and the Worker dlopen the same library and share its state.
import { dlopen, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ABI_VERSION = 4;

export const symbols = {
  mt_abi_version: { args: [], returns: "u32" },
  mt_app: { args: [], returns: "u32" },
  mt_info: { args: ["ptr", "u32"], returns: "u32" },
  mt_run: { args: ["ptr", "u32"], returns: "i32" },
  mt_quit: { args: ["i32"], returns: "void" },
  // Per instance (the window's is mt_app()).
  mt_set_wake: { args: ["u32", "function"], returns: "void" },
  mt_commit: { args: ["u32", "ptr", "u32"], returns: "i32" },
  mt_take_events: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_stats: { args: ["u32", "ptr", "u32"], returns: "u32" },
  // Headless instances and test hooks.
  mt_headless_new: { args: ["u32", "u32", "f32"], returns: "u32" },
  mt_headless_free: { args: ["u32"], returns: "void" },
  mt_test_input: { args: ["u32", "u32", "f32", "f32"], returns: "void" },
  mt_test_viewport: { args: ["u32", "u32", "u32", "f32"], returns: "void" },
  mt_test_key: { args: ["u32", "u32", "u32", "u32"], returns: "void" },
  mt_test_wheel: { args: ["u32", "f32", "f32", "f32", "f32"], returns: "void" },
  mt_test_step: { args: ["u32", "f64"], returns: "u32" },
  mt_test_hit: { args: ["u32", "f32", "f32"], returns: "u32" },
  mt_test_node_rect: { args: ["u32", "u32", "ptr"], returns: "i32" },
  mt_test_scene: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_test_capture: { args: ["u32", "ptr", "u32"], returns: "i32" },
  mt_test_resize: { args: ["u32", "u32", "u32", "u32", "u32", "u32"], returns: "void" },
} as const;

/** MANTOU_CORE, else the release build, else the debug build. */
export function libPath(): string {
  if (process.env.MANTOU_CORE) return process.env.MANTOU_CORE;
  const file = process.platform === "win32" ? `mantou_ffi.${suffix}` : `libmantou_ffi.${suffix}`;
  const target = join(import.meta.dir, "..", "core", "target");
  const release = join(target, "release", file);
  return existsSync(release) ? release : join(target, "debug", file);
}

export function openCore() {
  const path = libPath();
  if (!existsSync(path)) throw new Error(`mantou: native core not found at ${path} (run \`bun run build:core\`)`);
  const lib = dlopen(path, symbols);
  const v = lib.symbols.mt_abi_version();
  if (v !== ABI_VERSION) {
    throw new Error(`mantou: native core ABI ${v}, runtime expects ${ABI_VERSION} (${path}); rebuild it with \`bun run build:core\``);
  }
  return lib;
}

export type CoreLib = ReturnType<typeof openCore>;
