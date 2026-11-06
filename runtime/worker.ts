// The app Worker's entry. It registers the JSX plugin before anything that
// uses Solid loads (so only the plugin is a static import), then imports the
// app the bootstrap names.
import "./solid/preload";
import { setLaunchArgs } from "./launch";

globalThis.addEventListener("message", async (e: Event) => {
  const data = (e as MessageEvent).data;
  // `mantou dev` starts the next app's Worker ahead and has it load the
  // framework, so a reload only compiles and runs the app's own files.
  if (data?.type === "mantou:warm") {
    await import("./index");
    postMessage({ type: "mantou:warmed" });
    return;
  }
  if (data?.type !== "mantou:entry") return;
  setLaunchArgs(data.entry, data.argv);
  // Under `mantou dev`, errors go to the supervisor (runtime/dev.ts), which shows them and waits for a save.
  if (data.dev) (globalThis as { __mantouDev?: boolean }).__mantouDev = true;
  try {
    await import(data.entry);
  } catch (err) {
    if (data.dev) {
      postMessage({ type: "mantou:error", message: `the app failed to load: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
      return;
    }
    console.error("mantou: the app failed to load:", err);
    postMessage({ type: "mantou:failed", error: String((err as Error)?.stack ?? err) });
  }
});
