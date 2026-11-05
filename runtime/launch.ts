// The arguments an app was launched with, which the Worker's `process.argv` carries (not the bootstrap's flags).
const WITH_VALUE = new Set(["--width", "--height", "--min-width", "--min-height", "--max-width", "--max-height", "--title", "--watch"]);

/** `args` (what `start` got) without the entry and the bootstrap's own flags. */
export function launchArgs(args: string[], entry: string): string[] {
  const out: string[] = [];
  let skippedEntry = !entry;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (WITH_VALUE.has(a)) i++;
    else if (!skippedEntry && a === entry) skippedEntry = true;
    else out.push(a);
  }
  return out;
}

/** In the Worker: `process.argv` becomes [exec, entry, ...launch], as in a plain `bun app.ts file`. */
export function setLaunchArgs(entry: string, launch: string[] | undefined) {
  if (launch) process.argv = [process.argv[0], entry, ...launch];
}
