// What shows over the window: Dialog, Tooltip, Toast, Popover and HoverCard.
import { Show, Text, View, onKey, useWindowSize } from "../solid/components";
import { createSignal, onCleanup } from "../solid/solid";
import type { JSX, StyleProp } from "../jsx-runtime";
import { theme } from "./theme";
import { label } from "./shared";
import type { Rect } from "../ui";

export interface DialogProps {
  open: boolean;
  /** Escape, or a press on the backdrop. */
  onClose?: () => void;
  title?: string;
  children?: JSX.Element;
  style?: StyleProp;
}

/**
 * A dialog over the window: Tab stays inside it, Escape and a press on the
 * backdrop close it, and the focus goes back where it was when it closes.
 */
export function Dialog(props: DialogProps): JSX.Element {
  return (
    <Show when={props.open}>
      <DialogBody {...props} />
    </Show>
  );
}

function DialogBody(props: DialogProps): JSX.Element {
  onKey((e) => {
    if (e.type === "keyDown" && e.key === "Escape") props.onClose?.();
  });
  return (
    <View
      onPress={() => props.onClose?.()}
      style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: "#0006", alignItems: "center", justifyContent: "center" }}
    >
      <View
        focusScope
        role="dialog"
        label={props.title}
        onPress={(e) => e.stopPropagation()}
        style={[{ minWidth: 280, maxWidth: "90%", padding: 20, gap: 12, borderRadius: 12, backgroundColor: theme.surface, boxShadow: { y: 10, blur: 30, color: "#0004" } }, props.style]}
      >
        <Show when={props.title}>
          <Text style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>{props.title}</Text>
        </Show>
        {props.children}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface TooltipProps {
  text: string;
  /** Before it shows, in ms (default 500). */
  delay?: number;
  /** "below" (default) or "above" its anchor. */
  side?: "below" | "above";
  children: JSX.Element;
}

/** A tooltip: shows after the pointer rests on its children, hides when it leaves. */
export function Tooltip(props: TooltipProps): JSX.Element {
  const [shown, setShown] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(stop);
  return (
    <View
      onHover={(h) => {
        stop();
        if (h) timer = setTimeout(() => setShown(true), props.delay ?? 500);
        else setShown(false);
      }}
      onPointerDown={() => (stop(), setShown(false))}
      style={{ alignSelf: "start" }}
    >
      {props.children}
      <Show when={shown()}>
        <View
          role="status"
          style={{ pointerEvents: "none", position: "absolute", left: 0, ...(props.side === "above" ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }), zIndex: 900, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: theme.inverse }}
        >
          <Text style={{ color: theme.inverseText, fontSize: 12, whiteSpace: "nowrap" }}>{props.text}</Text>
        </View>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ToastProps {
  open: boolean;
  /** After `duration`, and for a press on it. */
  onClose?: () => void;
  /** In ms before it closes itself; 0 keeps it (default 4000). */
  duration?: number;
  children?: JSX.Element;
  style?: StyleProp;
}

/** A message at the bottom of the window that closes itself. Reopen it by setting `open` again. */
export function Toast(props: ToastProps): JSX.Element {
  return (
    <Show when={props.open}>
      <ToastBody {...props} />
    </Show>
  );
}

function ToastBody(props: ToastProps): JSX.Element {
  const ms = props.duration ?? 4000;
  if (ms > 0) {
    const timer = setTimeout(() => props.onClose?.(), ms);
    onCleanup(() => clearTimeout(timer));
  }
  return (
    <View style={{ position: "fixed", left: 0, right: 0, bottom: 24, zIndex: 1100, alignItems: "center", pointerEvents: "none" }}>
      <View
        role="status"
        onPress={() => props.onClose?.()}
        style={[{ pointerEvents: "auto", maxWidth: "90%", paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10, borderRadius: 8, backgroundColor: theme.inverse, boxShadow: { y: 4, blur: 16, color: "#0004" } }, props.style]}
      >
        {label(props.children, () => ({ color: theme.inverseText }))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface PopoverProps {
  open: boolean;
  /** Escape, or a press outside it. */
  onClose?: () => void;
  /** What it shows. */
  content: () => JSX.Element;
  /** Where, next to its anchor: "below" (default), "above", "right" or "left"; aligned to the anchor's start. */
  side?: "below" | "above" | "right" | "left";
  /** The anchor. */
  children: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

const SIDES = {
  below: { left: 0, top: "100%", marginTop: 6 },
  above: { left: 0, bottom: "100%", marginBottom: 6 },
  right: { left: "100%", top: 0, marginLeft: 6 },
  left: { right: "100%", top: 0, marginRight: 6 },
} as const;

type Side = "below" | "above" | "right" | "left";
const OPPOSITE: Record<Side, Side> = { below: "above", above: "below", right: "left", left: "right" };

/** The side a panel goes on: the one asked for, or the opposite when it doesn't fit there and does there. */
function useSide(asked: () => Side | undefined) {
  const win = useWindowSize();
  const [anchor, setAnchor] = createSignal<Rect | null>(null);
  const [panel, setPanel] = createSignal<Rect | null>(null);
  const side = (): Side => {
    const want = asked() ?? "below", a = anchor(), p = panel(), w = win();
    if (!a || !p) return want;
    const room: Record<Side, number> = { below: w.height - (a.y + a.height), above: a.y, right: w.width - (a.x + a.width), left: a.x };
    const need = want === "below" || want === "above" ? p.height + 6 : p.width + 6;
    return room[want] < need && room[OPPOSITE[want]] >= need ? OPPOSITE[want] : want;
  };
  return { side, onAnchor: (r: Rect) => setAnchor(r), onPanel: (r: Rect) => setPanel(r) };
}

/**
 * Content in a floating panel next to its anchor (on the other side when there's no room): Tab stays inside,
 * Escape and a press outside close it.
 */
export function Popover(props: PopoverProps): JSX.Element {
  const win = useWindowSize();
  const { side, onAnchor, onPanel } = useSide(() => props.side);
  return (
    <View onLayout={onAnchor} style={{ alignSelf: "start" }}>
      {props.children}
      <Show when={props.open}>
        <PopoverKeys onClose={props.onClose} />
        <View onPress={() => props.onClose?.()} style={{ position: "fixed", left: 0, top: 0, width: win().width, height: win().height, zIndex: 899 }} />
        <View
          testId={props.testId}
          focusScope
          role="dialog"
          onPress={(e) => e.stopPropagation()}
          onLayout={onPanel}
          enter={{ from: { opacity: 0, scale: 0.97 }, duration: 120 }}
          style={[{ position: "absolute", ...SIDES[side()], zIndex: 900, minWidth: 200, padding: 12, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 8, blur: 24, color: "#0003" } }, props.style]}
        >
          {props.content()}
        </View>
      </Show>
    </View>
  );
}

function PopoverKeys(props: { onClose?: () => void }): JSX.Element {
  onKey((e) => {
    if (e.type === "keyDown" && e.key === "Escape") props.onClose?.();
  });
  return null;
}

export interface HoverCardProps {
  /** What it shows while the pointer rests on its anchor (or on the card). */
  content: () => JSX.Element;
  /** Before it opens, and before it closes after the pointer leaves, in ms (default 400 and 150). */
  openDelay?: number;
  closeDelay?: number;
  side?: "below" | "above" | "right" | "left";
  children: JSX.Element;
  style?: StyleProp;
  testId?: string;
}

/** A card of detail that opens while the pointer rests on its anchor, and stays while the pointer is on it. */
export function HoverCard(props: HoverCardProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (to: boolean, ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => setOpen(to), ms);
  };
  onCleanup(() => clearTimeout(timer));
  const hover = (h: boolean) => (h ? later(true, props.openDelay ?? 400) : later(false, props.closeDelay ?? 150));
  const { side, onAnchor, onPanel } = useSide(() => props.side);
  return (
    <View onHover={hover} onLayout={onAnchor} style={{ alignSelf: "start" }}>
      {props.children}
      <Show when={open()}>
        <View
          testId={props.testId}
          role="group"
          onHover={(h) => (h ? clearTimeout(timer) : hover(false))}
          onLayout={onPanel}
          enter={{ from: { opacity: 0, translateY: 4 }, duration: 120 }}
          style={[{ position: "absolute", ...SIDES[side()], zIndex: 900, minWidth: 220, padding: 12, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.surface, boxShadow: { y: 8, blur: 24, color: "#0003" } }, props.style]}
        >
          {props.content()}
        </View>
      </Show>
    </View>
  );
}
