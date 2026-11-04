// mantou-ui: what apps import.
export { View, Text, Input, Image, Scroll, useWindowSize, For, Index, Show, Switch, Match, useUi, onKey } from "./solid/components";
export { mount } from "./solid/mount";
export {
  openFile, saveFile, message, showMenu, setMenu, onMenu,
  type OpenFileOptions, type SaveFileOptions, type MessageOptions, type MenuItem, type FileFilter,
} from "./platform";
export { run, type RunOptions } from "./run";
export { defineStyle, SharedStyle, Node, TextLeaf, Ui, type Style, type PressEvent, type WheelEvent, type KeyEvent, type Rect, type WindowSize, type ScrollOffset, type ScrollBlockName, type InputOptions } from "./ui";
export type { JSX, ViewProps, TextProps, InputProps, ScrollProps, ImageProps, StyleProp } from "./jsx-runtime";
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
