// An HTML mail in a reader: <Html> in a scroll view, remote images blocked until the reader allows
// them, inline (cid:) parts served by the app, and links opened in the browser.
import { Button, Html, Scroll, Show, Text, View, createSignal, openExternal, useColorScheme } from "mantou-ui";
import { LOGO, MESSAGE } from "./message";

export function MailReader(props: { fetchImage?: (url: string) => Promise<Uint8Array | null> }) {
  const [remote, setRemote] = createSignal(false);
  const [blocked, setBlocked] = createSignal(0);
  const scheme = useColorScheme();
  const load = async (url: string) => {
    if (url === "cid:logo@mantou") return LOGO;
    if (!remote()) {
      setBlocked((n) => n + 1);
      return null;
    }
    return (await props.fetchImage?.(url)) ?? null;
  };
  const mail = () => <Html html={MESSAGE} colorScheme={scheme()} loadImage={load} onLink={(url) => void openExternal(url)} style={{ width: "100%" }} />;
  return (
    <View style={{ flexGrow: 1, backgroundColor: scheme() === "dark" ? "#0d1117" : "#f6f8fa" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, flexShrink: 0 }}>
        <Text style={{ flexGrow: 1, fontSize: 13, color: scheme() === "dark" ? "#8b949e" : "#57606a" }}>
          {remote() ? "Remote images are shown." : `${blocked()} remote image${blocked() === 1 ? "" : "s"} blocked.`}
        </Text>
        <Show when={!remote()}>
          <Button variant="secondary" onPress={() => setRemote(true)}>Load images</Button>
        </Show>
      </View>
      <Scroll style={{ flexGrow: 1, minHeight: 0 }}>
        {/* Each branch is a document of its own: allowing images makes a new one, which asks for them again. */}
        <Show when={remote()} fallback={mail()}>
          {mail()}
        </Show>
      </Scroll>
    </View>
  );
}
