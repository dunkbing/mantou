// `mantou package --update-url <base>`: writes the update feed (latest.json) beside the artifacts (dunkbing/mantou#60).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFeed, platformKey, signAsset, type FeedAsset, type UpdateFeed } from "./update";

/** The artifact an update applies on this platform: the .dmg, the AppImage (else the .deb or tarball: the app shows a link), the NSIS setup. */
export function pickArtifact(files: string[], platform: string): string | undefined {
  const order = platform === "darwin" ? [/\.dmg$/] : platform === "linux" ? [/\.appimage$/i, /\.deb$/, /\.tar\.gz$/] : [/\.exe$/];
  for (const re of order) {
    const f = files.find((x) => re.test(x));
    if (f) return f;
  }
  return undefined;
}

export interface FeedOptions {
  version: string;
  /** Where the files will be hosted: each URL is this plus the file's name. */
  baseUrl: string;
  notes?: string;
  /** PKCS#8 PEM of the Ed25519 key that signs each build's hash. */
  signingKey?: string;
  platform?: string;
  arch?: string;
}

/** Writes `<outDir>/latest.json` for the artifact this machine made. Builds of other platforms already in a feed of the same version are kept, so one runner per OS can add its own. Returns the file's path. */
export async function writeFeed(outDir: string, made: string[], o: FeedOptions): Promise<string> {
  const platform = o.platform ?? process.platform;
  const file = pickArtifact(made, platform);
  if (!file) throw new Error("mantou package: no installable file was made to put in the update feed");
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  const asset: FeedAsset = { url: `${o.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(basename(file))}`, sha256, size: readFileSync(file).length };
  if (o.signingKey) asset.signature = await signAsset(sha256, o.signingKey);
  const path = join(outDir, "latest.json");
  let feed: UpdateFeed = { version: o.version, platforms: {} };
  if (existsSync(path)) {
    try {
      const old = parseFeed(readFileSync(path, "utf8"));
      if (old.version === o.version) feed = old;
    } catch {}
  }
  feed.platforms[platformKey(platform, o.arch)] = asset;
  if (o.notes) feed.notes = o.notes;
  writeFileSync(path, JSON.stringify(feed, null, 2) + "\n");
  return path;
}
