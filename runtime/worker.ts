// The app Worker's entry. It registers the JSX plugin before anything that
// uses Solid loads (so only the plugin is a static import), then imports the
// app the bootstrap names.
import "./solid/preload";

globalThis.addEventListener(
  "message",
  async (e: Event) => {
    const data = (e as MessageEvent).data;
    if (data?.type !== "mantou:entry") return;
    try {
      await import(data.entry);
    } catch (err) {
      console.error("mantou: the app failed to load:", err);
      postMessage("mantou:failed");
    }
  },
  { once: true },
);
