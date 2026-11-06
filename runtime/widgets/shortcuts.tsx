// Keyboard shortcuts: Kbd shows one as the platform writes it, ShortcutRecorder records one.
import { For, Show, Text, View } from "../solid/components";
import { createSignal } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label, resolve, useInteraction, isMac, type WidgetState, type WidgetStyle } from "./shared";
import type { KeyEvent } from "../ui";

/** "Mod+Shift+K" as the platform shows it: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. `Mod` is ⌘ or Ctrl. */
export function formatShortcut(shortcut: string): string[] {
  const names: Record<string, [string, string]> = {
    mod: ["⌘", "Ctrl"], cmd: ["⌘", "Win"], meta: ["⌘", "Win"], ctrl: ["⌃", "Ctrl"], control: ["⌃", "Ctrl"], shift: ["⇧", "Shift"], alt: ["⌥", "Alt"], option: ["⌥", "Alt"],
    enter: ["↩", "Enter"], escape: ["⎋", "Esc"], backspace: ["⌫", "Backspace"], delete: ["⌦", "Del"], tab: ["⇥", "Tab"], space: ["Space", "Space"],
    arrowup: ["↑", "↑"], arrowdown: ["↓", "↓"], arrowleft: ["←", "←"], arrowright: ["→", "→"],
  };
  return shortcut.split("+").filter(Boolean).map((k) => names[k.toLowerCase()]?.[isMac ? 0 : 1] ?? (k.length === 1 ? k.toUpperCase() : k));
}

export interface KbdProps {
  /** A shortcut like "Mod+Shift+K" (Mod is ⌘ on macOS, Ctrl elsewhere), shown as keycaps. */
  keys: string;
  style?: StyleProp;
  testId?: string;
}

/** A keyboard shortcut as keycaps, the way the platform writes it. */
export function Kbd(props: KbdProps): JSX.Element {
  return (
    <View testId={props.testId} label={formatShortcut(props.keys).join(isMac ? "" : "+")} style={[{ flexDirection: "row", gap: 3, flexShrink: 0 }, props.style]}>
      <For each={formatShortcut(props.keys)}>
        {(k) => (
          <View accessHidden style={{ minWidth: 20, height: 20, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderBottomWidth: 2, borderColor: theme.divider, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 11, color: theme.dimText, fontWeight: 500 }}>{k}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

/** A key event as a shortcut string ("Mod+Shift+K"), or null for a modifier alone. */
export function shortcutOf(e: Pick<KeyEvent, "key" | "shift" | "ctrl" | "alt" | "meta">): string | null {
  if (["Shift", "Control", "Alt", "Meta", "Super", "CapsLock", "Fn"].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.meta : e.ctrl) parts.push("Mod");
  if (isMac && e.ctrl) parts.push("Ctrl");
  if (!isMac && e.meta) parts.push("Meta");
  if (e.alt) parts.push("Alt");
  if (e.shift) parts.push("Shift");
  parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

export interface ShortcutRecorderProps {
  /** The shortcut ("Mod+Shift+K"), or null for none. */
  value: string | null;
  onChange?: (shortcut: string | null) => void;
  placeholder?: string;
  label?: string;
  style?: WidgetStyle<WidgetState & { recording: boolean }>;
  testId?: string;
}

/**
 * A field that records a keyboard shortcut: press it (or focus it and press Enter), then press the keys. Escape
 * cancels, Backspace clears. A shortcut needs a key besides the modifiers, and a modifier unless it's an F key.
 */
export function ShortcutRecorder(props: ShortcutRecorderProps): JSX.Element {
  const { state, handlers } = useInteraction(() => false);
  const [recording, setRecording] = createSignal(false);
  const keys = (e: KeyEvent) => {
    if (e.type !== "keyDown" || !recording()) return;
    e.stopPropagation?.();
    if (e.key === "Escape" && !e.shift && !e.ctrl && !e.alt && !e.meta) return setRecording(false);
    if ((e.key === "Backspace" || e.key === "Delete") && !e.shift && !e.ctrl && !e.alt && !e.meta) {
      setRecording(false);
      return props.onChange?.(null);
    }
    const s = shortcutOf(e);
    if (!s) return;
    const fKey = /^F\d+$/.test(e.key);
    if (!fKey && !e.ctrl && !e.alt && !e.meta) return; // a plain letter isn't a shortcut
    setRecording(false);
    props.onChange?.(s);
  };
  return (
    <View
      {...handlers}
      testId={props.testId}
      role="button"
      label={props.label ?? (props.value ? `Shortcut ${formatShortcut(props.value).join(" ")}` : "Record a shortcut")}
      focusable
      onKey={keys}
      onBlur={() => (handlers.onBlur(), setRecording(false))}
      onPress={() => setRecording(!recording())}
      style={[
        { minWidth: 140, height: 32, paddingLeft: 8, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, borderWidth: 1, cursor: "pointer", alignSelf: "start",
          borderColor: recording() ? theme.accent : state().hovered ? theme.borderHover : theme.border, backgroundColor: theme.control },
        resolve(props.style, { ...state(), recording: recording() }),
      ]}
    >
      <Show when={!recording() && props.value} fallback={<Text style={{ color: recording() ? theme.accent : theme.placeholder }}>{recording() ? "Press keys…" : props.placeholder ?? "Record shortcut"}</Text>}>
        <Kbd keys={props.value!} />
      </Show>
    </View>
  );
}
