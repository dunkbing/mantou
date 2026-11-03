// Sample mail for Mantou Mail. Times are relative to a fixed "now", so the
// app (and its tests) show the same thing every run.

export const NOW = new Date("2026-11-03T09:30:00");

export type Folder = "inbox" | "archive" | "trash" | "sent" | "snoozed";

export interface Label {
  id: string;
  name: string;
  color: string;
}

export const LABELS: Label[] = [
  { id: "design", name: "Design", color: "#8b5cf6" },
  { id: "finance", name: "Finance", color: "#10b981" },
  { id: "travel", name: "Travel", color: "#f59e0b" },
  { id: "family", name: "Family", color: "#ef4444" },
];

export interface Account {
  id: string;
  name: string;
  email: string;
}

export const ACCOUNTS: Account[] = [
  { id: "work", name: "Work", email: "sam@northwind.dev" },
  { id: "personal", name: "Personal", email: "sam.rivera@fastmail.com" },
];

export interface Message {
  id: number;
  account: string;
  folder: Folder;
  from: { name: string; email: string };
  subject: string;
  body: string[];
  date: Date;
  unread: boolean;
  starred: boolean;
  /** People and security mail; the rest (newsletters, notifications) is "Other". */
  important: boolean;
  labels: string[];
  /** You replied and are waiting for an answer, since this date. */
  waitingSince?: Date;
  snoozedUntil?: string;
}

const ago = (days: number, hours = 0, minutes = 0) => new Date(NOW.getTime() - ((days * 24 + hours) * 60 + minutes) * 60_000);

let next = 1;
function msg(m: Omit<Message, "id" | "unread" | "starred" | "important" | "labels" | "folder"> & Partial<Message>): Message {
  return { id: next++, unread: false, starred: false, important: true, labels: [], folder: "inbox", ...m };
}

export function sampleMessages(): Message[] {
  next = 1;
  return [
    msg({
      account: "work", from: { name: "Priya Shah", email: "priya@northwind.dev" }, date: ago(0, 0, 18), unread: true, labels: ["design"],
      subject: "Onboarding flow: final review before Thursday",
      body: [
        "Hi Sam,",
        "I've put the last round of changes to the onboarding flow in the shared file. The biggest change is that the workspace picker now comes after sign-in, so new people never see an empty list.",
        "Could you take a look before Thursday's review? I'd especially like a second opinion on the copy for the invite step — it still feels a little long to me.",
        "Thanks!\nPriya",
      ],
    }),
    msg({
      account: "work", from: { name: "GitHub", email: "noreply@github.com" }, date: ago(0, 0, 42), unread: true, important: false,
      subject: "[northwind/app] Release v4.2.0 is ready for review (#1834)",
      body: ["mira-k requested your review on this pull request.", "Changes: 14 commits, 38 files changed, +1,204 −612.", "View it on GitHub or reply to this email to comment."],
    }),
    msg({
      account: "personal", from: { name: "Mum", email: "elena.rivera@gmail.com" }, date: ago(0, 1, 5), unread: true, labels: ["family"],
      subject: "Sunday lunch?",
      body: ["Hi love, are you and Alex free for lunch on Sunday? Your aunt is visiting and would love to see you both.", "I'm making the lasagne. Let me know by Friday so I know how much to make!", "Love, Mum x"],
    }),
    msg({
      account: "work", from: { name: "Daniel Okafor", email: "daniel@northwind.dev" }, date: ago(0, 2, 10), starred: true,
      subject: "Q4 planning — draft OKRs attached",
      body: [
        "Team,",
        "Attached is the first draft of our Q4 OKRs. I've kept it to three objectives this time: ship the new onboarding, halve p95 sync latency, and grow weekly active teams by 15%.",
        "Please add comments directly in the doc by Wednesday end of day. We'll finalise in Thursday's planning meeting.",
        "Daniel",
      ],
    }),
    msg({
      account: "work", from: { name: "Stripe", email: "receipts@stripe.com" }, date: ago(0, 3, 30), important: false, labels: ["finance"],
      subject: "Your receipt from Figma #2231-7746",
      body: ["Amount paid: $180.00", "Date paid: November 3, 2026", "Payment method: Visa •••• 4242", "If you have any questions, contact us at support@figma.com."],
    }),
    msg({
      account: "personal", from: { name: "Alex Kim", email: "alex.kim@hey.com" }, date: ago(0, 4, 0), unread: true, labels: ["travel"],
      subject: "Lisbon flights are cheap again",
      body: ["Just saw TAP has return flights for €140 in early December. Want to do a long weekend? We could finally try that place in Alfama your sister keeps talking about.", "I can book tonight if you're in."],
    }),
    msg({
      account: "work", from: { name: "Security", email: "security@northwind.dev" }, date: ago(1, 1, 0), unread: true,
      subject: "New sign-in to your account from Berlin, Germany",
      body: ["We noticed a new sign-in to your Northwind account.", "Device: Safari on macOS\nLocation: Berlin, Germany\nTime: November 2, 08:31", "If this was you, you don't need to do anything. If not, reset your password right away."],
    }),
    msg({
      account: "work", from: { name: "Mira Kowalski", email: "mira@northwind.dev" }, date: ago(1, 3, 0), waitingSince: ago(3),
      subject: "Re: Sync latency investigation",
      body: [
        "I dug into the traces from last week. Most of the p95 comes from the conflict-resolution pass running on the main request path — it re-reads the whole document when only one block changed.",
        "I have a patch that moves it to a background job and only re-reads changed blocks. Early numbers: p95 down from 840 ms to 310 ms on the staging dataset.",
        "Still waiting on your thoughts about whether we can ship this before the freeze.",
      ],
    }),
    msg({
      account: "personal", from: { name: "The Browser", email: "hello@thebrowser.com" }, date: ago(1, 5, 0), important: false,
      subject: "Five things worth reading this week",
      body: ["1. The quiet return of the paper map.", "2. Why your houseplants are dying (it's not the light).", "3. An oral history of the spreadsheet.", "4. The economics of the perfect croissant.", "5. How lighthouses got their patterns."],
    }),
    msg({
      account: "work", from: { name: "Linear", email: "notifications@linear.app" }, date: ago(1, 7, 0), important: false,
      subject: "NW-482 moved to In Review: Workspace picker after sign-in",
      body: ["Priya Shah moved NW-482 from In Progress to In Review.", "Workspace picker after sign-in · Onboarding · Due Nov 6"],
    }),
    msg({
      account: "personal", from: { name: "Monzo", email: "help@monzo.com" }, date: ago(2, 2, 0), important: false, labels: ["finance"],
      subject: "Your October statement is ready",
      body: ["Your statement for October 2026 is ready to view in the app.", "Money in: £4,120.00\nMoney out: £3,286.41"],
    }),
    msg({
      account: "work", from: { name: "Jonas Weber", email: "jonas@acme.io" }, date: ago(2, 4, 0), waitingSince: ago(5), labels: ["finance"],
      subject: "Re: Renewal terms for 2027",
      body: [
        "Thanks for sending the usage numbers. I've shared them with our procurement team.",
        "We're aiming to get back to you with a counter-proposal on the multi-year discount next week. Is the 15th still a good date for a call?",
      ],
    }),
    msg({
      account: "personal", from: { name: "Clara Rivera", email: "clara.r@icloud.com" }, date: ago(2, 6, 0), starred: true, labels: ["family", "travel"],
      subject: "Photos from the weekend 📸",
      body: ["Finally got around to sorting the photos from the lake. The one of Dad falling off the paddleboard is my favourite.", "Shared album link is in the family chat too."],
    }),
    msg({
      account: "work", from: { name: "Figma", email: "no-reply@figma.com" }, date: ago(3, 1, 0), important: false, labels: ["design"],
      subject: "Priya Shah commented on Onboarding v7",
      body: ["\"Can we try the illustration at 80% size here? It pushes the button below the fold on smaller laptops.\"", "Reply in Figma to respond."],
    }),
    msg({
      account: "work", from: { name: "Hannah Lee", email: "hannah@northwind.dev" }, date: ago(3, 5, 0),
      subject: "Offsite: please fill in the dietary form",
      body: ["Hi all, a quick reminder to fill in the dietary requirements form for the December offsite by Friday.", "We've booked the venue in the Peak District — more details soon!"],
    }),
    msg({
      account: "personal", from: { name: "Airbnb", email: "automated@airbnb.com" }, date: ago(4, 2, 0), important: false, labels: ["travel"],
      subject: "Reminder: your stay in Porto starts in 3 weeks",
      body: ["Your reservation: Riverside loft with a view, Nov 27 – Nov 30.", "Check-in: 15:00 · Check-out: 11:00"],
    }),
    msg({
      account: "work", from: { name: "Omar Haddad", email: "omar@northwind.dev" }, date: ago(5, 3, 0),
      subject: "Design system: new spacing tokens",
      body: ["I've merged the new spacing tokens. Anything that used the old 6 px step now maps to 8 px.", "If something looks off in your area, ping me and I'll take a look."],
    }),
    msg({
      account: "personal", from: { name: "Strava", email: "no-reply@strava.com" }, date: ago(6, 1, 0), important: false,
      subject: "You ran 42.3 km in October",
      body: ["That's 12% more than September. Your longest run was 14.1 km on October 19."],
    }),
    msg({
      account: "work", from: { name: "Sofia Martins", email: "sofia@northwind.dev" }, date: ago(7, 2, 0),
      subject: "Interview loop for the senior designer role",
      body: ["Thanks for joining the loop! Here's the plan: portfolio review on Monday, then a paired exercise on Wednesday.", "I've added you to both calendar invites."],
    }),
    msg({
      account: "personal", from: { name: "Library", email: "library@camden.gov.uk" }, date: ago(9, 0, 0), important: false,
      subject: "Your books are due back on 7 November",
      body: ["Items due: The Overstory; A Pattern Language.", "Renew online or at any branch."],
    }),
    // Elsewhere: sent, archived, snoozed.
    msg({ account: "work", folder: "sent", from: { name: "Sam Rivera", email: "sam@northwind.dev" }, date: ago(3), subject: "Sync latency investigation", body: ["Mira — could you look into where the p95 is coming from? Happy to pair on it."] }),
    msg({ account: "work", folder: "archive", from: { name: "Daniel Okafor", email: "daniel@northwind.dev" }, date: ago(12), subject: "Q3 retro notes", body: ["Notes from the retro are in the wiki."] }),
    msg({ account: "personal", folder: "snoozed", snoozedUntil: "Tomorrow, 08:00", from: { name: "Alex Kim", email: "alex.kim@hey.com" }, date: ago(1, 9), subject: "Plant-sitting next weekend?", body: ["Could you water the plants while we're away? Keys are under the blue pot."] }),
  ];
}

/** "09:12" today, "Yesterday", a weekday within a week, else "Oct 28". */
export function shortDate(d: Date): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(NOW) - day(d)) / 86_400_000);
  if (days === 0) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function longDate(d: Date): string {
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

export function daysSince(d: Date): number {
  return Math.max(1, Math.round((NOW.getTime() - d.getTime()) / 86_400_000));
}
