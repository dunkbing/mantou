// <WebView>: a web page drawn into the window, through Bun.WebView. The page is rendered off screen and
// its frames shown as an image, so Mantou content can overlap it; input is forwarded to it.
import { Image, View } from "./solid/components";
import { createEffect, createSignal, onCleanup } from "./solid/solid";
import type { JSX, StyleProp } from "./jsx-runtime";
import { activeUi } from "./platform";
import type { KeyEvent } from "./ui";

export interface WebViewProps {
  /** A URL to load. */
  src?: string;
  /** HTML to show (instead of `src`). */
  html?: string;
  style?: StyleProp;
  /** The page navigated. */
  onNavigate?: (url: string, title: string) => void;
  /** The page can't be loaded. */
  onError?: (message: string) => void;
  /** Called with the page when it exists, to drive it (`evaluate`, `goBack`, `reload`…). Not with `native`. */
  ref?: (view: Bun.WebView) => void;
  /**
   * Use a real child web view of the window (macOS only for now) instead of drawing frames: selection, text
   * input and video work, but it sits above Mantou's own drawing and can't be overlapped.
   */
  native?: boolean;
  /** With `native`: a message the page sent with `window.ipc.postMessage(text)`. */
  onMessage?: (text: string) => void;
  /** With `native`: called with `{ run(script), load }` to drive the page. */
  nativeRef?: (view: { run(script: string): void }) => void;
}

const FAST = 50, SLOW = 400, BUSY_FOR = 1500;

export function WebView(props: WebViewProps): JSX.Element {
  if (props.native) return NativeWebView(props);
  const [frame, setFrame] = createSignal<Uint8Array | null>(null);
  const [box, setBox] = createSignal({ x: 0, y: 0, w: 0, h: 0 });
  let view: Bun.WebView | null = null;
  let closed = false;
  let activeUntil = 0;
  let lastHash: number | bigint = 0;
  const wake = () => (activeUntil = Date.now() + BUSY_FOR);

  const load = () => {
    if (!view) return;
    wake();
    const where = props.html !== undefined ? "data:text/html;charset=utf-8," + encodeURIComponent(props.html) : props.src;
    if (where) view.navigate(where).catch((e) => props.onError?.(String(e?.message ?? e)));
  };

  createEffect(() => {
    const { w, h } = box();
    if (w < 1 || h < 1 || closed) return;
    if (!view) {
      view = new Bun.WebView({ width: Math.round(w), height: Math.round(h) });
      view.onNavigated = (url, title) => (wake(), props.onNavigate?.(url, title));
      props.ref?.(view);
      load();
      void loop();
    } else void view.resize(Math.round(w), Math.round(h)).then(wake);
  });
  createEffect(() => {
    props.src, props.html;
    load();
  });

  async function loop() {
    while (!closed && view) {
      try {
        const png = await view.screenshot({ encoding: "buffer" });
        const hash = Bun.hash(png);
        if (hash !== lastHash) {
          lastHash = hash;
          setFrame(new Uint8Array(png));
        }
      } catch {} // the view is going away or isn't ready yet
      await Bun.sleep(Date.now() < activeUntil ? FAST : SLOW);
    }
  }
  onCleanup(() => {
    closed = true;
    view?.close();
    view = null;
  });

  const rel = (e: { x: number; y: number }) => [e.x - box().x, e.y - box().y] as const;
  const key = (e: KeyEvent) => {
    if (e.type !== "keyDown" || !view || e.ctrl || e.meta) return;
    wake();
    if (e.key.length === 1) void view.type(e.key);
    else void view.press(e.key, { modifiers: e.shift ? ["Shift"] : [] });
    e.stopPropagation?.();
  };
  return (
    <View
      style={[{ overflow: "hidden" }, props.style as object]}
      focusable
      onKey={key}
      onLayout={(r) => setBox({ x: r.x, y: r.y, w: r.width, h: r.height })}
      onPress={(e) => {
        if (!view) return;
        wake();
        const [x, y] = rel(e);
        void view.click(x, y);
      }}
      onWheel={(e) => {
        wake();
        void view?.scroll(e.dx, e.dy);
      }}
    >
      {frame() && <Image src={frame()!} style={{ width: "100%", height: "100%", objectFit: "fill" }} />}
    </View>
  );
}

function NativeWebView(props: WebViewProps): JSX.Element {
  const ui = activeUi();
  if (!ui) throw new Error("mantou: <WebView native> needs a window");
  const id = ui.nextWebview++;
  const ask = (op: string, extra: object = {}) => ui.service<boolean>({ kind: "webview", op, id, ...extra });
  const page = () => (props.html !== undefined ? { html: props.html } : { url: props.src });
  let made = false;
  let gone = false;
  ui.webviews.set(id, (kind, text) => {
    if (kind === 1) return props.onMessage?.(text);
    const m = JSON.parse(text);
    props.onNavigate?.(m.url, m.title);
  });
  onCleanup(() => {
    gone = true;
    ui.webviews.delete(id);
    if (made) void ask("close");
  });
  props.nativeRef?.({ run: (script) => void ask("eval", { script }) });
  createEffect(() => {
    props.src, props.html;
    if (made) void ask("load", page());
  });
  return (
    <View
      style={props.style}
      onLayout={(r) => {
        const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        if (made) return void ask("bounds", rect);
        made = true;
        void ask("create", { ...rect, ...page() }).then((ok) => {
          if (ok !== true) {
            made = false;
            if (!gone) props.onError?.("native web views aren't available here");
          }
        });
      }}
    />
  );
}
