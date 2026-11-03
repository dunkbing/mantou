// Mantou Mail: a sidebar of mailboxes and labels, a message list, a reader and
// keyboard triage. j/k move · e archive · # delete · s star · u unread ·
// r reply · z undo · 1/2 Important/Other.
import { For, Show, Text, View, createEffect, createSignal, defineStyle, onKey, useUi, type Node } from "mantou-ui";
import { ACCOUNTS, LABELS, daysSince, longDate, shortDate, type Message } from "./data";
import { QUICK_REPLIES, createMail, mailboxName, sameMailbox, usesTabs, type Mail, type Mailbox, type Tab } from "./state";

// ---------------------------------------------------------------- theme
const C = {
  text: "#111827",
  secondary: "#4b5563",
  muted: "#9ca3af",
  line: "#e5e7eb",
  faint: "#f3f4f6",
  sidebar: "#f7f7f9",
  accent: "#4f46e5",
  accentSoft: "#eef2ff",
  unread: "#3b82f6",
};
const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const hline = defineStyle({ height: 1, backgroundColor: C.line });
const vline = defineStyle({ width: 1, flexShrink: 0, backgroundColor: C.line });
const caption = defineStyle({ fontSize: 11, fontWeight: 600, color: C.muted });
const small = defineStyle({ fontSize: 12, color: C.muted });

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar(props: { name: string; size: number }) {
  return (
    <View style={{ width: props.size, height: props.size, flexShrink: 0, borderRadius: props.size / 2, backgroundColor: avatarColor(props.name), justifyContent: "center" }}>
      <Text style={{ color: "#ffffff", fontSize: props.size * 0.38, fontWeight: 600, textAlign: "center" }}>{initials(props.name)}</Text>
    </View>
  );
}

function Chip(props: { text: string; color: string; background: string }) {
  return (
    <View style={{ height: 20, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 10, backgroundColor: props.background, justifyContent: "center" }}>
      <Text style={{ fontSize: 11, fontWeight: 500, color: props.color, maxLines: 1 }}>{props.text}</Text>
    </View>
  );
}

function LabelChips(props: { message: Message }) {
  return (
    <For each={props.message.labels}>
      {(id) => {
        const l = LABELS.find((x) => x.id === id)!;
        return <Chip text={l.name} color={l.color} background={`${l.color}1f`} />;
      }}
    </For>
  );
}

// ---------------------------------------------------------------- sidebar
function SidebarItem(props: { mail: Mail; mailbox: Mailbox; name: string; count?: number; dot?: string; indent?: boolean }) {
  const active = () => sameMailbox(props.mail.mailbox(), props.mailbox);
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 30, paddingLeft: props.indent ? 22 : 10, paddingRight: 10, borderRadius: 6, backgroundColor: active() ? C.accentSoft : "transparent" }}
      onPress={() => props.mail.open(props.mailbox)}
    >
      <Show when={props.dot}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.dot ?? "transparent" }} />
      </Show>
      <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, fontWeight: active() ? 600 : 500, color: active() ? C.accent : C.text, maxLines: 1 }}>{props.name}</Text>
      <Show when={(props.count ?? 0) > 0}>
        <Text style={{ fontSize: 12, fontWeight: 500, color: active() ? C.accent : C.muted }}>{props.count}</Text>
      </Show>
    </View>
  );
}

function Sidebar(props: { mail: Mail }) {
  const m = props.mail;
  return (
    <View style={{ width: 228, flexShrink: 0, paddingTop: 18, paddingLeft: 12, paddingRight: 12, gap: 2, backgroundColor: C.sidebar }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingBottom: 14 }}>
        <View style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, backgroundColor: C.accent, justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontWeight: 700, fontSize: 14, textAlign: "center" }}>M</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Mantou Mail</Text>
      </View>
      <SidebarItem mail={m} mailbox={{ kind: "all" }} name="All inboxes" count={m.unread({ kind: "all" })} />
      <For each={ACCOUNTS}>
        {(a) => <SidebarItem mail={m} mailbox={{ kind: "account", id: a.id }} name={a.name} count={m.unread({ kind: "account", id: a.id })} indent />}
      </For>
      <View style={{ height: 10 }} />
      <SidebarItem mail={m} mailbox={{ kind: "starred" }} name="Starred" count={m.count({ kind: "starred" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "snoozed" }} name="Snoozed" count={m.count({ kind: "folder", folder: "snoozed" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "sent" }} name="Sent" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "archive" }} name="Archive" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "trash" }} name="Trash" />
      <View style={{ height: 16 }} />
      <Text style={[caption, { paddingLeft: 10, paddingBottom: 6 }]}>LABELS</Text>
      <For each={LABELS}>
        {(l) => <SidebarItem mail={m} mailbox={{ kind: "label", id: l.id }} name={l.name} dot={l.color} count={m.unread({ kind: "label", id: l.id })} />}
      </For>
    </View>
  );
}

// ---------------------------------------------------------------- toolbar
function ToolButton(props: { label: string; hint: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6, height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff", opacity: props.disabled ? 0.45 : 1 }}
      onPress={() => !props.disabled && props.onPress()}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{props.label}</Text>
      <Text style={{ fontSize: 11, color: C.muted }}>{props.hint}</Text>
    </View>
  );
}

function TabButton(props: { mail: Mail; tab: Tab; name: string }) {
  const active = () => props.mail.tab() === props.tab;
  return (
    <View style={{ height: 52, justifyContent: "center" }} onPress={() => props.mail.setTab(props.tab)}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 4, paddingRight: 4, flexGrow: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: active() ? 600 : 500, color: active() ? C.text : C.muted }}>{props.name}</Text>
        <Show when={props.mail.unreadInTab(props.tab) > 0}>
          <Chip text={String(props.mail.unreadInTab(props.tab))} color={active() ? "#ffffff" : C.secondary} background={active() ? C.accent : C.faint} />
        </Show>
      </View>
      <View style={{ height: 2, backgroundColor: active() ? C.accent : "transparent" }} />
    </View>
  );
}

function Toolbar(props: { mail: Mail }) {
  const m = props.mail;
  const none = () => !m.selected();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 52, paddingLeft: 20, paddingRight: 16, gap: 18 }}>
      <Show when={usesTabs(m.mailbox())} fallback={<Text style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{mailboxName(m.mailbox())}</Text>}>
        <TabButton mail={m} tab="important" name="Important" />
        <TabButton mail={m} tab="other" name="Other" />
      </Show>
      <View style={{ flexGrow: 1 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <ToolButton label="Archive" hint="E" onPress={m.archive} disabled={none()} />
        <ToolButton label="Reply" hint="R" onPress={m.toggleReply} disabled={none()} />
        <ToolButton label="Older" hint="J" onPress={() => m.move(1)} disabled={none()} />
        <ToolButton label="Newer" hint="K" onPress={() => m.move(-1)} disabled={none()} />
        <ToolButton label="Delete" hint="#" onPress={m.remove} disabled={none()} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- list
function Row(props: { mail: Mail; message: Message; ref: (n: Node) => void }) {
  const msg = () => props.message;
  const selected = () => props.mail.selected()?.id === msg().id;
  return (
    <View
      ref={props.ref}
      style={{ flexDirection: "row", gap: 10, paddingTop: 12, paddingBottom: 12, paddingLeft: 10, paddingRight: 16, backgroundColor: selected() ? C.accentSoft : "#ffffff" }}
      onPress={() => props.mail.select(msg().id)}
    >
      <View style={{ width: 6, height: 6, flexShrink: 0, marginTop: 13, borderRadius: 3, backgroundColor: msg().unread ? C.unread : "transparent" }} />
      <Avatar name={msg().from.name} size={32} />
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, fontWeight: msg().unread ? 700 : 500, color: C.text, maxLines: 1 }}>{msg().from.name}</Text>
          <Show when={msg().starred}>
            <Text style={{ fontSize: 12, color: "#f59e0b" }}>★</Text>
          </Show>
          <Text style={small}>{shortDate(msg().date)}</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: msg().unread ? 600 : 400, color: C.text, maxLines: 1 }}>{msg().subject}</Text>
        <Text style={{ fontSize: 12, color: C.secondary, maxLines: 1 }}>{msg().body.join(" ").replace(/\s+/g, " ")}</Text>
        <Show when={msg().labels.length > 0 || msg().waitingSince || msg().snoozedUntil}>
          <View style={{ flexDirection: "row", gap: 6, paddingTop: 4 }}>
            <Show when={msg().waitingSince}>
              <Chip text={`Waiting for reply · ${daysSince(msg().waitingSince!)}d`} color="#9a3412" background="#fff7ed" />
            </Show>
            <Show when={msg().snoozedUntil}>
              <Chip text={`Snoozed until ${msg().snoozedUntil}`} color="#075985" background="#f0f9ff" />
            </Show>
            <LabelChips message={msg()} />
          </View>
        </Show>
      </View>
    </View>
  );
}

function MessageList(props: { mail: Mail }) {
  const m = props.mail;
  const [scroll, setScroll] = createSignal(0);
  let viewport: Node | undefined;
  let content: Node | undefined;
  const rows = new Map<number, Node>();
  const clamp = (y: number) => {
    const max = Math.max(0, (content?.measure()?.height ?? 0) - (viewport?.measure()?.height ?? 0));
    return Math.max(0, Math.min(max, y));
  };
  // Keep the selected row in view.
  createEffect(() => {
    const s = m.selected();
    const row = s && rows.get(s.id)?.measure();
    const vp = viewport?.measure();
    if (!row || !vp) return;
    const top = row.y - vp.y;
    if (top < 0) setScroll((y) => clamp(y + top));
    else if (top + row.height > vp.height) setScroll((y) => clamp(y + top + row.height - vp.height));
  });
  createEffect(() => {
    m.mailbox();
    m.tab();
    setScroll(0);
  });
  return (
    <View ref={viewport} style={{ width: 400, flexShrink: 0, overflow: "hidden", backgroundColor: "#ffffff" }} onWheel={(e) => setScroll((y) => clamp(y + e.dy))}>
      <View ref={content} style={{ marginTop: -scroll() }}>
        <For each={m.list()} fallback={<Text style={[small, { padding: 24, textAlign: "center" }]}>Nothing here</Text>}>
          {(msg) => (
            <>
              <Row mail={m} message={msg} ref={(n) => rows.set(msg.id, n)} />
              <View style={[hline, { marginLeft: 58, backgroundColor: C.faint }]} />
            </>
          )}
        </For>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- reader
function Reader(props: { mail: Mail }) {
  const m = props.mail;
  const [scroll, setScroll] = createSignal(0);
  let viewport: Node | undefined;
  let content: Node | undefined;
  createEffect(() => {
    m.selected()?.id;
    setScroll(0);
  });
  const wheel = (dy: number) => {
    const max = Math.max(0, (content?.measure()?.height ?? 0) - (viewport?.measure()?.height ?? 0));
    setScroll((y) => Math.max(0, Math.min(max, y + dy)));
  };
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, backgroundColor: "#ffffff" }}>
      <Show when={m.selected()} fallback={<Text style={[small, { padding: 48, textAlign: "center" }]}>No message selected</Text>}>
        <View ref={viewport} style={{ flexGrow: 1, overflow: "hidden" }} onWheel={(e) => wheel(e.dy)}>
          <View ref={content} style={{ marginTop: -scroll(), paddingTop: 28, paddingLeft: 36, paddingRight: 36, paddingBottom: 28, gap: 18 }}>
            <Text style={{ fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{m.selected()!.subject}</Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Avatar name={m.selected()!.from.name} size={40} />
              <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontWeight: 600, color: C.text, maxLines: 1 }}>{m.selected()!.from.name}</Text>
                <Text style={[small, { maxLines: 1 }]}>{`${m.selected()!.from.email} → ${ACCOUNTS.find((a) => a.id === m.selected()!.account)!.email}`}</Text>
              </View>
              <Text style={small}>{longDate(m.selected()!.date)}</Text>
            </View>
            <Show when={m.selected()!.labels.length > 0 || m.selected()!.waitingSince}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Show when={m.selected()!.waitingSince}>
                  <Chip text={`Waiting for reply · ${daysSince(m.selected()!.waitingSince!)}d`} color="#9a3412" background="#fff7ed" />
                </Show>
                <LabelChips message={m.selected()!} />
              </View>
            </Show>
            <View style={hline} />
            <View style={{ gap: 14 }}>
              <For each={m.selected()!.body}>{(p) => <Text style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937" }}>{p}</Text>}</For>
            </View>
          </View>
        </View>
        <Show when={m.replying()}>
          <View style={hline} />
          <View style={{ paddingTop: 14, paddingBottom: 16, paddingLeft: 36, paddingRight: 36, gap: 10, backgroundColor: "#fafafa" }}>
            <Text style={caption}>{`QUICK REPLY TO ${m.selected()!.from.name.toUpperCase()}`}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <For each={QUICK_REPLIES}>
                {(text, i) => (
                  <View style={{ height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff", justifyContent: "center" }} onPress={() => m.reply(text)}>
                    <Text style={{ fontSize: 13, color: C.text }}>{`${i() + 1}  ${text}`}</Text>
                  </View>
                )}
              </For>
            </View>
          </View>
        </Show>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------- app
export function App(props: { mail?: Mail }) {
  const m = props.mail ?? createMail();
  const ui = useUi();
  createEffect(() => {
    const unread = m.unread({ kind: "all" });
    ui.title(unread ? `Mantou Mail — ${unread} unread` : "Mantou Mail");
  });
  onKey((e) => {
    if (e.type !== "keyDown" || e.ctrl || e.meta || e.alt) return;
    if (m.replying() && /^[1-3]$/.test(e.key)) return m.reply(QUICK_REPLIES[Number(e.key) - 1]);
    switch (e.key) {
      case "j": case "ArrowDown": return m.move(1);
      case "k": case "ArrowUp": return m.move(-1);
      case "e": return m.archive();
      case "#": case "Delete": case "Backspace": return m.remove();
      case "s": return m.star();
      case "u": return m.toggleUnread();
      case "r": return m.toggleReply();
      case "z": return m.undo();
      case "1": return usesTabs(m.mailbox()) && m.setTab("important");
      case "2": return usesTabs(m.mailbox()) && m.setTab("other");
      case "Escape": return m.replying() && m.toggleReply();
    }
  });

  return (
    // minHeight 0: flex items are at least as tall as their content otherwise
    // (as in CSS), and the list and reader clip and scroll instead.
    <View style={{ flexGrow: 1, minHeight: 0, flexDirection: "row", backgroundColor: "#ffffff" }}>
      <Sidebar mail={m} />
      <View style={vline} />
      <View style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Toolbar mail={m} />
        <View style={hline} />
        <View style={{ flexGrow: 1, minHeight: 0, flexDirection: "row" }}>
          <MessageList mail={m} />
          <View style={vline} />
          <Reader mail={m} />
        </View>
        <View style={hline} />
        <View style={{ flexDirection: "row", alignItems: "center", height: 28, paddingLeft: 16, paddingRight: 16, gap: 12, backgroundColor: "#fafafa" }}>
          <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 12, color: C.secondary, maxLines: 1 }}>{m.status() ? `${m.status()} · Z to undo` : `${m.list().length} conversations`}</Text>
          <Text style={[small, { maxLines: 1 }]}>J/K move · E archive · # delete · S star · U unread · R reply</Text>
        </View>
      </View>
    </View>
  );
}
