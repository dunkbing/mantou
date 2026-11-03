// Mantou Mail on a headless instance of the real core: what you see, what
// presses, keys and the wheel do.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "../../runtime/headless";
import { App } from "./App";
import { createMail, type Mail } from "./state";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  let mail!: Mail;
  mount(h.ui, () => {
    mail = createMail();
    return <App mail={mail} />;
  });
  h.step();
  return { h, mail };
}

const texts = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isText).map((n) => n.textContent);
function text(h: HeadlessCore, content: string, nth = 0): Node {
  const found = [...h.ui.nodes.values()].filter((n) => n.isText && n.textContent === content);
  if (!found[nth]) throw new Error(`no text "${content}" (have: ${texts(h).slice(0, 40).join(" | ")})`);
  return found[nth];
}
const readerSubject = (h: HeadlessCore, mail: Mail) => text(h, mail.selected()!.subject, 1); // [0] is the list row

test("opens on the Important tab of all inboxes, newest first, with the first message in the reader", () => {
  const { h, mail } = app();
  expect(mail.list()[0].subject).toBe("Onboarding flow: final review before Thursday");
  expect(h.rect(readerSubject(h, mail))![0]).toBeGreaterThan(600); // the reader is right of the list
  expect(texts(h)).toContain("Important");
  expect(texts(h)).toContain("All inboxes");
  expect(h.stats().opErrors).toBe(0);
});

test("pressing a row opens it and marks it read", () => {
  const { h, mail } = app();
  const before = mail.unread({ kind: "all" });
  h.press(text(h, "Sunday lunch?"));
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  expect(mail.selected()!.unread).toBe(false);
  expect(mail.unread({ kind: "all" })).toBe(before - 1);
  expect(texts(h).filter((t) => t === "Sunday lunch?").length).toBe(2); // list row and reader
});

test("keyboard triage: j/k move, e archives, z undoes, s stars", () => {
  const { h, mail } = app();
  const first = mail.list()[0];
  h.key("j");
  expect(mail.selected()!.id).toBe(mail.list()[1].id);
  h.key("k");
  expect(mail.selected()!.id).toBe(first.id);
  const n = mail.list().length;
  h.key("e");
  expect(mail.list().length).toBe(n - 1);
  expect(mail.messages().find((m) => m.id === first.id)!.folder).toBe("archive");
  expect(texts(h).some((t) => t.startsWith("Archived “Onboarding flow"))).toBe(true);
  h.key("z");
  expect(mail.list().length).toBe(n);
  h.key("s");
  expect(mail.selected()!.starred).toBe(true);
});

test("the Other tab holds newsletters and notifications", () => {
  const { h, mail } = app();
  h.key("2");
  expect(mail.tab()).toBe("other");
  expect(mail.list().every((m) => !m.important)).toBe(true);
  expect(texts(h)).toContain("[northwind/app] Release v4.2.0 is ready for review (#1834)");
  h.press(text(h, "Important"));
  expect(mail.tab()).toBe("important");
});

test("the wheel scrolls the list, and the selection stays in view", () => {
  const { h, mail } = app();
  const row = text(h, "Onboarding flow: final review before Thursday");
  const y0 = h.rect(row)![1];
  h.wheel(400, 400, 120);
  expect(h.rect(row)![1]).toBeCloseTo(y0 - 120, 0);
  h.wheel(400, 400, -1000);
  expect(h.rect(row)![1]).toBeCloseTo(y0, 0); // clamped at the top
  for (let i = 0; i < 12; i++) h.key("j");
  const sel = text(h, mail.selected()!.subject);
  const r = h.rect(sel)!;
  expect(r[1]).toBeGreaterThan(52);
  expect(r[3]).toBeLessThan(760 - 28);
});

test("quick reply: r shows the replies, 1 sends the first", () => {
  const { h, mail } = app();
  h.key("r");
  expect(mail.replying()).toBe(true);
  expect(texts(h).some((t) => t.startsWith("QUICK REPLY TO PRIYA SHAH"))).toBe(true);
  h.key("1");
  expect(mail.replying()).toBe(false);
  expect(texts(h)).toContain("Reply sent to Priya Shah · Z to undo");
  h.press(text(h, "Sent"));
  expect(mail.list().map((m) => m.subject)).toContain("Re: Onboarding flow: final review before Thursday");
});

test("the sidebar switches mailboxes and shows unread counts", () => {
  const { h, mail } = app();
  h.press(text(h, "Starred"));
  expect(mail.list().length).toBe(2);
  expect(texts(h)).toContain("Starred"); // the toolbar shows the mailbox's name instead of tabs
  h.press(text(h, "Family"));
  expect(mail.list().map((m) => m.from.name).sort()).toEqual(["Clara Rivera", "Mum"]);
  h.press(text(h, "Work"));
  expect(mail.list().every((m) => m.account === "work")).toBe(true);
});

test("it draws: sidebar, accent, text", () => {
  const { h } = app();
  const shot = h.capture();
  expect(shot.at(100, 700)).toEqual([0xf7, 0xf7, 0xf9, 255]); // sidebar
  let ink = 0;
  for (let x = 660; x < 1100; x++) if (shot.at(x, 95)[0] < 80) ink++; // the reader's subject line
  expect(ink).toBeGreaterThan(100);
}, 30_000);
