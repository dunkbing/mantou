// bun:ffi bindings to the native core (core/crates/mantou-ffi). Both the main
// thread and the Worker dlopen the same library and share its state.
import { dlopen, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const ABI_VERSION = 14;

export const symbols = {
  mt_abi_version: { args: [], returns: "u32" },
  mt_app: { args: [], returns: "u32" },
  mt_info: { args: ["ptr", "u32"], returns: "u32" },
  mt_run: { args: ["ptr", "u32"], returns: "i32" },
  mt_service: { args: ["u32", "u32", "ptr", "u32"], returns: "u32" },
  mt_quit: { args: ["i32"], returns: "void" },
  // Per instance (the window's is mt_app()).
  mt_reset: { args: ["u32"], returns: "void" },
  mt_window_open: { args: ["ptr", "u32"], returns: "u32" },
  mt_window_close: { args: ["u32"], returns: "void" },
  mt_window_focus: { args: ["u32"], returns: "void" },
  mt_set_wake: { args: ["u32", "ptr"], returns: "void" },
  mt_commit: { args: ["u32", "ptr", "u32"], returns: "i32" },
  mt_take_events: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_stats: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_input_selection: { args: ["u32", "u32", "ptr"], returns: "i32" },
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
  mt_test_cursor: { args: ["u32"], returns: "u32" },
  mt_test_scene: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_test_capture: { args: ["u32", "ptr", "u32"], returns: "i32" },
  mt_test_resize: { args: ["u32", "u32", "u32", "u32", "u32", "u32"], returns: "void" },
  mt_test_text: { args: ["u32", "ptr", "u32"], returns: "void" },
  mt_test_ime: { args: ["u32", "ptr", "u32", "u32", "u32"], returns: "void" },
  mt_test_set_clipboard: { args: ["u32", "ptr", "u32"], returns: "void" },
  mt_test_clipboard: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_test_value: { args: ["u32", "u32", "ptr", "u32"], returns: "u32" },
  mt_test_focused: { args: ["u32"], returns: "u32" },
  mt_test_answer: { args: ["u32", "ptr", "u32"], returns: "void" },
  mt_test_service: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_test_drop: { args: ["u32", "u32", "ptr", "u32"], returns: "void" },
  mt_test_button: { args: ["u32", "u32", "u32", "f32", "f32"], returns: "void" },
  mt_test_access: { args: ["u32", "ptr", "u32"], returns: "u32" },
  mt_test_menu: { args: ["u32", "ptr", "u32"], returns: "void" },
} as const;

/** The npm package with the prebuilt core for this machine (an optional dependency of mantou-ui), e.g. mantou-ui-linux-x64. */
export const PLATFORM_PACKAGE = `mantou-ui-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const FILE = process.platform === "win32" ? `mantou_ffi.${suffix}` : `libmantou_ffi.${suffix}`;

/** The prebuilt core from PLATFORM_PACKAGE, if it's installed. */
export function prebuiltPath(): string | null {
  try {
    const path = join(dirname(Bun.resolveSync(`${PLATFORM_PACKAGE}/package.json`, import.meta.dir)), FILE);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** MANTOU_CORE, else a core built from this copy of mantou-ui (release, then debug), else the prebuilt one. */
export function libPath(): string {
  if (process.env.MANTOU_CORE) return process.env.MANTOU_CORE;
  // A compiled app ships the core beside its executable (`mantou build`).
  const beside = join(dirname(process.execPath), FILE);
  if (existsSync(beside)) return beside;
  const target = join(import.meta.dir, "..", "core", "target");
  const release = join(target, "release", FILE), debug = join(target, "debug", FILE);
  for (const p of [release, debug]) if (existsSync(p)) return p;
  return prebuiltPath() ?? release;
}

export function openCore() {
  const path = libPath();
  if (!existsSync(path)) {
    throw new Error(
      `mantou: no native core: ${PLATFORM_PACKAGE} (the prebuilt one) isn't installed, and none is built at ${path}; ` +
        "reinstall mantou-ui, or build one with `mantou build-core` (needs Rust)",
    );
  }
  const lib = dlopen(path, symbols);
  const v = lib.symbols.mt_abi_version();
  if (v !== ABI_VERSION) {
    throw new Error(`mantou: native core ABI ${v}, runtime expects ${ABI_VERSION} (${path}); rebuild it with \`bun run build:core\``);
  }
  return lib;
}

export type CoreLib = ReturnType<typeof openCore>;
