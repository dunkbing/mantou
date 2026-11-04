// mantou-ui: what apps import.
export { View, Text, Input, Image, Scroll, List, useWindowSize, For, Index, Show, Switch, Match, useUi, onKey } from "./solid/components";
export { mount } from "./solid/mount";
export {
  clipboard, openFile, saveFile, message, showMenu, setMenu, onMenu, onFileDrop, win, type WindowInfo, openExternal, reveal, notify, setBadge, createTray, removeTray, type NotifyOptions, type TrayOptions,
  type OpenFileOptions, type SaveFileOptions, type MessageOptions, type MenuItem, type FileFilter,
} from "./platform";
export { useColorScheme, setColorScheme, defineTheme, type ColorScheme } from "./theme";
export { run, type RunOptions } from "./run";
export { defineStyle, SharedStyle, Node, TextLeaf, Ui, type Style, type AccessInfo, type AccessRoleName, type DropEvent, type WindowState, type PointerEvent, type PressEvent, type WheelEvent, type KeyEvent, type Rect, type WindowSize, type ScrollOffset, type ScrollBlockName, type InputOptions, type AnimatableProp, type AnimateOptions, type Animation, type Easing, type Transitions, type TransitionSpec } from "./ui";
export type { JSX, ViewProps, TextProps, InputProps, ScrollProps, ImageProps, ListProps, ListHandle, StyleProp } from "./jsx-runtime";
export {
  createSignal,
  createMemo,
  createEffect,
  createRoot,
  batch,
  untrack,
  on,
  onCleanup,
  onMount,
} from "./solid/solid";
