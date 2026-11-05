// The HTML mail reader, headless on the real core: remote images wait until "Load images", then the
// document is made again and asks for them; the inline logo is served all along.
import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { encodePng } from "mantou-ui/images";
import { HeadlessCore } from "../../runtime/headless";
import { MailReader } from "./MailReader";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("remote images are blocked until the reader allows them", async () => {
  const fetched: string[] = [];
  const photo = encodePng({ width: 4, height: 2, pixels: new Uint8Array(32).fill(200) });
  const h = new HeadlessCore({ width: 600, height: 640 });
  open.push(h);
  mount(h.ui, () => <MailReader fetchImage={async (url) => (fetched.push(url), photo)} />);
  // The Text showing `s`, if any; for a button's label, the pressable view around it.
  const find = (s: string) => [...h.ui.nodes.values()].find((n) => n.isText && !n.released && n.parent && n.textContent === s) ?? null;
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) {
      await Bun.sleep(1);
      h.step();
    }
  };
  h.step();
  await until(() => find("2 remote images blocked.") !== null);
  expect(find("2 remote images blocked.")).not.toBeNull();
  expect(fetched).toEqual([]);
  h.press(find("Load images")!);
  await until(() => fetched.length === 2);
  expect(fetched.sort()).toEqual(["https://example.com/beacon.gif", "https://picsum.photos/id/1015/496/160"]);
  expect(find("Remote images are shown.")).not.toBeNull();
});
