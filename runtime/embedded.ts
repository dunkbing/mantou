// Files embedded in a compiled app (`import x from "./a.png" with { type: "file" }`) live in Bun's virtual
// filesystem, which the native core can't open (#86). Bun reads them; the core gets bytes or a real temp file.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The path of a `file:` URL, else the string as is. */
function plain(p: string): string {
  if (!p.startsWith("file:")) return p;
  try {
    return fileURLToPath(p);
  } catch {
    return decodeURIComponent(new URL(p).pathname); // Windows rejects /$bunfs/...
  }
}

/** Whether `path` is inside a compiled executable (`/$bunfs/...`, or `B:/~BUN/...` on Windows). */
export function isEmbedded(path: string): boolean {
  const p = plain(path).replaceAll("\\", "/");
  return p.startsWith("/$bunfs/") || /^[A-Za-z]:\/~BUN\//i.test(p) || p.startsWith("/~BUN/");
}

/** The bytes of an embedded file, or null when `path` is a real one. */
export function embeddedBytes(path: string): Uint8Array | null {
  return isEmbedded(path) ? new Uint8Array(readFileSync(plain(path))) : null;
}

/** A path the core can open: `path` itself, or for an embedded file a copy in the temp folder (named by content). */
export function realPath(path: string): string {
  const bytes = embeddedBytes(path);
  if (!bytes) return plain(path);
  const dir = join(tmpdir(), "mantou-embedded");
  const file = join(dir, createHash("sha1").update(bytes).digest("hex").slice(0, 16) + extname(plain(path)));
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, bytes);
  }
  return file;
}
