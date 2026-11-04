// A screen that shows off what Mantou draws today: a scrolling list, inputs
// (one secure), shadows, rounded corners and an app font. The README's
// screenshot is rendered from it (`bun run screenshots`).
import { For, Input, Scroll, Text, View, defineStyle } from "mantou-ui";

const mail = [
  ["Ana Souza", "Trip on Saturday", "I booked the cabin, can you bring the…", "#f97316", true],
  ["Kenji Mori", "Re: Q4 numbers", "Looks good. Two small notes on the…", "#0ea5e9", true],
  ["Lena Fischer", "Design review", "Moving it to Thursday at 3, if that…", "#8b5cf6", false],
  ["Omar Haddad", "Invoice #2291", "Attached is the invoice for October…", "#10b981", false],
  ["Priya Nair", "Lunch?", "There's a new ramen place on 5th…", "#ec4899", false],
  ["Sam Lee", "Build is green", "All three platforms pass now, ship it", "#eab308", false],
  ["Tomás Ruiz", "Photos", "Here are the ones from the weekend…", "#14b8a6", false],
  ["Yuki Tanaka", "Re: Fonts", "The monospace one renders nicely", "#6366f1", false],
] as const;

const card = defineStyle({ backgroundColor: "#ffffff", borderRadius: 14, boxShadow: { y: 10, blur: 30, spread: -6, color: "#0f172a33" } });
const field = defineStyle({
  height: 38,
  paddingLeft: 12,
  paddingRight: 12,
  borderRadius: 9,
  borderWidth: 1,
  borderColor: "#e2e8f0",
  backgroundColor: "#f8fafc",
  fontSize: 14,
  color: "#0f172a",
  flexShrink: 0,
});
const label = defineStyle({ fontSize: 12, fontWeight: 600, color: "#64748b" });

/** `mono`: a monospace font family the app registered, for the code card. */
export function Showcase(props: { mono?: string }) {
  const code = (color: string) => ({ fontFamily: props.mono ?? "monospace", fontSize: 13, color });
  return (
    <View style={{ flexGrow: 1, minHeight: 0, flexDirection: "row", gap: 24, padding: 28, backgroundColor: "#eef2f7" }}>
      <View style={[card, { width: 330, minHeight: 0, flexShrink: 0, paddingTop: 16 }]}>
        <Text style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", paddingLeft: 18, paddingBottom: 10 }}>Inbox</Text>
        <Scroll style={{ flexGrow: 1, minHeight: 0 }}>
          <For each={[...mail]}>
            {([from, subject, preview, color, unread]) => (
              <View style={{ flexDirection: "row", gap: 12, paddingLeft: 18, paddingRight: 18, paddingTop: 11, paddingBottom: 11, alignItems: "center" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, justifyContent: "center", flexShrink: 0 }}>
                  <Text style={{ color: "#ffffff", fontWeight: 700, textAlign: "center", fontSize: 14 }}>{from[0]}</Text>
                </View>
                <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: unread ? 700 : 500, color: "#0f172a", maxLines: 1 }}>{from}</Text>
                  <Text style={{ fontSize: 13, color: "#334155", maxLines: 1 }}>{subject}</Text>
                  <Text style={{ fontSize: 12, color: "#94a3b8", maxLines: 1 }}>{preview}</Text>
                </View>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: unread ? "#2563eb" : "transparent", flexShrink: 0 }} />
              </View>
            )}
          </For>
        </Scroll>
      </View>
      <View style={{ flexGrow: 1, gap: 20, minWidth: 0 }}>
        <View style={[card, { padding: 20, gap: 10 }]}>
          <Text style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>New message</Text>
          <Text style={label}>TO</Text>
          <Input style={[field, { borderColor: "#2563eb", boxShadow: { spread: 3, color: "#2563eb26" } }]} defaultValue="ana@example.com" autoFocus />
          <Text style={label}>PASSWORD</Text>
          <Input style={field} secure defaultValue="hunter2hunter2" />
          <View style={{ flexDirection: "row", gap: 10, paddingTop: 4 }}>
            <View style={{ height: 36, paddingLeft: 18, paddingRight: 18, borderRadius: 9, backgroundColor: "#2563eb", justifyContent: "center", boxShadow: { y: 4, blur: 12, color: "#2563eb55" } }}>
              <Text style={{ color: "#ffffff", fontWeight: 600, fontSize: 14 }}>Send</Text>
            </View>
            <View style={{ height: 36, paddingLeft: 18, paddingRight: 18, borderRadius: 9, borderWidth: 1, borderColor: "#cbd5e1", justifyContent: "center" }}>
              <Text style={{ color: "#334155", fontWeight: 600, fontSize: 14 }}>Discard</Text>
            </View>
          </View>
        </View>
        <View style={[card, { padding: 18, gap: 4, backgroundColor: "#0f172a" }]}>
          <Text style={code("#94a3b8")}>// app.tsx: Bun + TypeScript, native window</Text>
          <Text style={code("#e2e8f0")}>run(() =&gt; &lt;App /&gt;);</Text>
          <Text style={code("#7dd3fc")}>bun add mantou-ui</Text>
        </View>
      </View>
    </View>
  );
}
