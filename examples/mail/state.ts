// Mantou Mail's state: Solid signals and the actions the UI and the keyboard
// share. Nothing here knows about views.
import { batch, createMemo, createSignal } from "mantou-ui";
import { ACCOUNTS, LABELS, NOW, sampleMessages, type Folder, type Message } from "./data";

export type Mailbox =
  | { kind: "all" }
  | { kind: "account"; id: string }
  | { kind: "folder"; folder: Exclude<Folder, "inbox"> }
  | { kind: "starred" }
  | { kind: "label"; id: string };

export type Tab = "important" | "other";

export function sameMailbox(a: Mailbox, b: Mailbox): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mailboxName(m: Mailbox): string {
  switch (m.kind) {
    case "all": return "All inboxes";
    case "account": return ACCOUNTS.find((a) => a.id === m.id)?.name ?? m.id;
    case "folder": return m.folder[0].toUpperCase() + m.folder.slice(1);
    case "starred": return "Starred";
    case "label": return LABELS.find((l) => l.id === m.id)?.name ?? m.id;
  }
}

export function inMailbox(msg: Message, m: Mailbox): boolean {
  switch (m.kind) {
    case "all": return msg.folder === "inbox";
    case "account": return msg.folder === "inbox" && msg.account === m.id;
    case "folder": return msg.folder === m.folder;
    case "starred": return msg.starred && msg.folder !== "trash";
    case "label": return msg.labels.includes(m.id) && msg.folder !== "trash";
  }
}

/** Inboxes split into Important (people, security) and Other (everything else). */
export const usesTabs = (m: Mailbox) => m.kind === "all" || m.kind === "account";

export const QUICK_REPLIES = ["Thanks, got it!", "Sounds good — see you then.", "Let me check and get back to you today."];

export function createMail(initial: Message[] = sampleMessages()) {
  const [messages, setMessages] = createSignal(initial);
  const [mailbox, setMailbox] = createSignal<Mailbox>({ kind: "all" });
  const [tab, setTab] = createSignal<Tab>("important");
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [replying, setReplying] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const history: Message[][] = [];

  const list = createMemo(() => {
    const m = mailbox();
    return messages()
      .filter((msg) => inMailbox(msg, m) && (!usesTabs(m) || (tab() === "important") === msg.important))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  });
  const selected = createMemo(() => list().find((m) => m.id === selectedId()) ?? list()[0] ?? null);

  const unread = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m) && msg.unread).length;
  const count = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m)).length;
  const unreadInTab = (t: Tab) => messages().filter((msg) => inMailbox(msg, mailbox()) && (t === "important") === msg.important && msg.unread).length;

  /** Changes messages; the previous state goes on the undo stack. */
  function change(fn: (ms: Message[]) => Message[], message: string) {
    history.push(messages());
    if (history.length > 50) history.shift();
    setMessages(fn(messages()));
    setStatus(message);
  }
  const patch = (id: number, p: Partial<Message>) => (ms: Message[]) => ms.map((m) => (m.id === id ? { ...m, ...p } : m));

  /** The message after (or else before) the selected one, to select once it leaves the list. */
  function neighbour(): number | null {
    const l = list(), s = selected();
    if (!s) return null;
    const i = l.indexOf(s);
    return (l[i + 1] ?? l[i - 1])?.id ?? null;
  }

  function select(id: number) {
    batch(() => {
      setSelectedId(id);
      setReplying(false);
      if (messages().find((m) => m.id === id)?.unread) setMessages(patch(id, { unread: false })(messages()));
    });
  }
  function leave(folder: Folder, verb: string) {
    const s = selected();
    if (!s) return;
    const next = neighbour();
    batch(() => {
      change(patch(s.id, { folder, unread: false }), `${verb} “${s.subject}”`);
      setSelectedId(null);
      if (next !== null) select(next); // opening the next message marks it read, as opening any does
      setReplying(false);
    });
  }



  return {
    messages, list, selected, mailbox, tab, replying, status, unread, count, unreadInTab, select,

    move(delta: number) {
      const l = list(), s = selected();
      if (!l.length) return;
      const i = s ? l.indexOf(s) : -1;
      select(l[Math.max(0, Math.min(l.length - 1, i + delta))].id);
    },
    open(m: Mailbox) {
      batch(() => {
        setMailbox(m);
        setSelectedId(null);
        setReplying(false);
      });
    },
    setTab(t: Tab) {
      batch(() => {
        setTab(t);
        setSelectedId(null);
        setReplying(false);
      });
    },
    archive: () => leave("archive", "Archived"),
    remove: () => leave("trash", "Deleted"),
    star() {
      const s = selected();
      if (s) change(patch(s.id, { starred: !s.starred }), s.starred ? "Unstarred" : "Starred");
    },
    toggleUnread() {
      const s = selected();
      if (s) change(patch(s.id, { unread: !s.unread }), s.unread ? "Marked as read" : "Marked as unread");
    },
    toggleReply() {
      setReplying(!replying());
    },
    reply(text: string) {
      const s = selected();
      if (!s) return;
      const account = ACCOUNTS.find((a) => a.id === s.account)!;
      const sent: Message = {
        id: Math.max(...messages().map((m) => m.id)) + 1,
        account: s.account,
        folder: "sent",
        from: { name: "Sam Rivera", email: account.email },
        subject: s.subject.startsWith("Re: ") ? s.subject : `Re: ${s.subject}`,
        body: [text],
        date: NOW,
        unread: false,
        starred: false,
        important: true,
        labels: [],
      };
      batch(() => {
        change((ms) => [...patch(s.id, { waitingSince: NOW })(ms), sent], `Reply sent to ${s.from.name}`);
        setReplying(false);
      });
    },
    undo() {
      const prev = history.pop();
      if (!prev) return setStatus("Nothing to undo");
      batch(() => {
        setMessages(prev);
        setStatus("Undone");
      });
    },
  };
}

export type Mail = ReturnType<typeof createMail>;
