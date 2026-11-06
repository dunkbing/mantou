// `mantou snap` (see snap-run.ts). The JSX plugin is registered before anything that uses Solid loads: static
// imports load before a module runs, so the rest comes in with a dynamic import.
export async function snap(args: string[]): Promise<number> {
  await import("./solid/preload");
  const { snapRun } = await import("./snap-run");
  return snapRun(args);
}
