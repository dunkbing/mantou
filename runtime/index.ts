// mantou-ui: what apps import.
export { View, Text, Input, useWindowSize, For, Index, Show, Switch, Match, useUi, onKey } from "./solid/components";
export { mount } from "./solid/mount";
export { run, type RunOptions } from "./run";
export { defineStyle, SharedStyle, Node, TextLeaf, Ui, type Style, type PressEvent, type WheelEvent, type KeyEvent, type Rect, type WindowSize, type InputOptions } from "./ui";
export type { JSX, ViewProps, TextProps, InputProps, StyleProp } from "./jsx-runtime";
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
