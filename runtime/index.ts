// mantou-ui: what apps import.
export { View, Text, Input, Image, Canvas, Scroll, List, useWindowSize, For, Index, Show, Switch, Match, useUi, onKey } from "./solid/components";
export { mount } from "./solid/mount";
export { openWindow, type OpenWindowOptions, type WindowHandle } from "./windows";
export { Button, Checkbox, Toggle, RadioGroup, Slider, Tabs, Dialog, Tooltip, Splitter, Select, Combobox, Menu, Table, Toast, Progress, Spinner, type ComboboxProps, type MenuProps, type MenuEntry, type TableProps, type TableColumn, type SpinnerProps, type SelectProps, type SelectOption, type ToastProps, type ProgressProps, type WidgetState, type WidgetStyle, type ButtonProps, type CheckboxProps, type ToggleProps, type RadioGroupProps, type RadioOption, type SliderProps, type TabsProps, type DialogProps, type TooltipProps, type SplitterProps } from "./widgets";
export {
  clipboard, openFile, saveFile, message, dialogsAvailable, showMenu, setMenu, onMenu, onFileDrop, win, type WindowInfo, monitors, type Monitor, openExternal, reveal, notify, setBadge, createTray, removeTray, type NotifyOptions, type TrayOptions,
  type OpenFileOptions, type SaveFileOptions, type MessageOptions, type MenuItem, type FileFilter,
} from "./platform";
export { useColorScheme, setColorScheme, defineTheme, type ColorScheme } from "./theme";
export { run, type RunOptions } from "./run";
export { defineStyle, SharedStyle, Node, TextLeaf, Ui, type Style, type AccessInfo, type AccessRoleName, type DropEvent, type WindowState, type EnterSpec, type ExitSpec, type MotionTiming, type PointerEvent, type PressEvent, type WheelEvent, type KeyEvent, type Rect, type WindowSize, type ScrollOffset, type ScrollBlockName, type InputOptions, type AnimatableProp, type AnimateOptions, type Animation, type Easing, type Transitions, type TransitionSpec } from "./ui";
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
export { dumpTree } from "./debug";
export { CanvasContext, Path } from "./canvas";
export { paths } from "./paths";
export { launchAtLogin } from "./autostart";
export { WebView, type WebViewProps } from "./webview";
export { singleInstance, onOpen } from "./instance";
export { onError, type AppError, type ErrorHandler } from "./errors";
