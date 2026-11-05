// Runs instance-app.ts in a Worker the way the bootstrap does (runtime/main.ts), with the launch args.
import { launchArgs } from "../../runtime/launch";
const entry = "tests/fixtures/instance-app.ts";
const args = [entry, "--width", "300", ...Bun.argv.slice(2)];
const w = new Worker(new URL("../../runtime/worker.ts", import.meta.url).href);
w.addEventListener("close", () => process.exit(0));
w.postMessage({ type: "mantou:entry", entry: Bun.pathToFileURL(entry).href, argv: launchArgs(args, entry) });
process.stdin.on("data", () => process.exit(0));
