// bun run mail  (bun runtime/cli.ts run examples/mail/main.tsx)
import { run } from "mantou-ui";
import { MailReader } from "./MailReader";

const fetchImage = async (url: string) => {
  const r = await fetch(url).catch(() => null);
  return r?.ok ? new Uint8Array(await r.arrayBuffer()) : null;
};

run(() => <MailReader fetchImage={fetchImage} />, { title: "HTML mail", width: 640, height: 720 });
