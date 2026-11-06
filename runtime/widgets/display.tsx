// Showing a state or a value: Progress, Spinner, Badge, Avatar and RollingNumber.
import { Image, Index, Show, Text, View } from "../solid/components";
import { onMount } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label } from "./shared";

export interface ProgressProps {
  /** 0 to 1. */
  value: number;
  label?: string;
  style?: StyleProp;
}

/** A progress bar. */
export function Progress(props: ProgressProps): JSX.Element {
  const frac = () => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return (
    <View role="status" label={props.label ?? `${Math.round(frac() * 100)}%`} style={[{ height: 8, minWidth: 120, borderRadius: 4, backgroundColor: theme.divider, overflow: "hidden" }, props.style]}>
      <View style={{ height: "100%", width: `${frac() * 100}%`, backgroundColor: theme.accent }} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SpinnerProps {
  /** Diameter in px (default 20). */
  size?: number;
  color?: string;
  label?: string;
  style?: StyleProp;
}

/** A busy indicator: a ring of dots, fading behind the leading one, turning (the core runs the turn). */
export function Spinner(props: SpinnerProps): JSX.Element {
  const size = props.size ?? 20;
  const dot = Math.max(2, Math.round(size / 5));
  const radius = (size - dot) / 2;
  const dots = Array.from({ length: 8 }, (_, i) => i);
  return (
    <View
      role="status"
      label={props.label ?? "Loading"}
      ref={(n) => onMount(() => void n.animate("rotate", { from: 0, to: 360, duration: 900, easing: "linear", iterations: Infinity }))}
      style={[{ width: size, height: size, flexShrink: 0 }, props.style]}
    >
      {dots.map((i) => {
        const a = (i / 8) * 2 * Math.PI;
        return (
          <View
            style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, backgroundColor: props.color ?? theme.accent, opacity: 1 - (i / 8) * 0.85,
              left: size / 2 - dot / 2 + radius * Math.sin(a), top: size / 2 - dot / 2 - radius * Math.cos(a) }}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface BadgeProps {
  /** "neutral" (default), "accent", "success", "warning" or "danger". */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  children?: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

const TONES = {
  neutral: { bg: () => theme.controlHover, fg: () => theme.dimText },
  accent: { bg: () => theme.accent, fg: () => theme.accentText },
  success: { bg: () => "#16a34a", fg: () => "#ffffff" },
  warning: { bg: () => "#f59e0b", fg: () => "#1f1300" },
  danger: { bg: () => "#dc2626", fg: () => "#ffffff" },
};

/** A small label for a count or a state ("3", "New", "Beta"). */
export function Badge(props: BadgeProps): JSX.Element {
  const tone = () => TONES[props.tone ?? "neutral"];
  return (
    <View testId={props.testId} role="status" style={[{ flexShrink: 0, minWidth: 20, height: 20, paddingLeft: 7, paddingRight: 7, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tone().bg() }, props.style]}>
      {label(props.children, () => ({ color: tone().fg(), fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }))}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface AvatarProps {
  /** Its initials come from the name; its colour too, so a person keeps theirs. */
  name: string;
  /** A picture instead of the initials (a path, or the file's bytes). */
  src?: string | Uint8Array;
  /** Diameter in px (default 32). */
  size?: number;
  style?: StyleProp;
  testId?: string;
}

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#16a34a", "#0891b2", "#4f46e5"];

/** A person's picture, or their initials on a colour of their own. */
export function Avatar(props: AvatarProps): JSX.Element {
  const size = () => props.size ?? 32;
  const initials = () => props.name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? "").join("");
  const color = () => AVATAR_COLORS[[...props.name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % AVATAR_COLORS.length];
  return (
    <View testId={props.testId} role="image" label={props.name} style={[{ width: size(), height: size(), borderRadius: size() / 2, flexShrink: 0, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: color() }, props.style]}>
      <Show when={props.src} fallback={<Text style={{ color: "#ffffff", fontSize: Math.round(size() * 0.4), fontWeight: 600 }}>{initials()}</Text>}>
        <Image src={props.src!} style={{ width: size(), height: size(), objectFit: "cover" }} />
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface RollingNumberProps {
  /** What it shows; digits roll when it changes, other characters swap. */
  value: number | string;
  /** Font size (default 24); the line is 1.25 × that. */
  size?: number;
  color?: string;
  fontWeight?: number;
  style?: StyleProp;
  testId?: string;
}

const DIGITS = "0123456789";

/**
 * A number whose digits roll to their new values, like an odometer: each digit is a column of 0–9 sliding
 * under a clip on a spring (the core runs it). Digits keep their place from the right, so 99 → 100 rolls the
 * last two and adds a 1. Screen readers hear the value.
 */
export function RollingNumber(props: RollingNumberProps): JSX.Element {
  const size = () => props.size ?? 24;
  const line = () => Math.round(size() * 1.25);
  const chars = () => [...String(props.value)];
  // From the right (laid out right to left, by position): a digit keeps its column, and rolls, as the number grows.
  const fromRight = () => chars().reverse();
  const text = (): StyleProp => ({ fontSize: size(), lineHeight: line() / size(), height: line(), color: props.color ?? theme.text, fontWeight: props.fontWeight ?? 600, textAlign: "center" });
  return (
    <View testId={props.testId} role="status" label={String(props.value)} style={[{ flexDirection: "rowReverse", alignSelf: "start", height: line(), overflow: "hidden" }, props.style]}>
      <Index each={fromRight()}>
        {(c) => (
          <Show when={DIGITS.includes(c())} fallback={<Text accessHidden style={text()}>{c()}</Text>}>
            <View accessHidden style={{ height: line(), overflow: "hidden" }}>
              <View transition={{ translateY: { spring: { stiffness: 260, damping: 26 } } }} style={{ translateY: -DIGITS.indexOf(c()) * line() }}>
                {[...DIGITS].map((d) => <Text style={text()}>{d}</Text>)}
              </View>
            </View>
          </Show>
        )}
      </Index>
    </View>
  );
}
