import type { APIRoute, GetStaticPaths, ImageMetadata } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';

// Serves every docs page as raw Markdown at `/<id>.md`
// (e.g. /design/protocols.md next to /design/protocols/, and /index.md for the home page).

export const getStaticPaths = (async () => {
	const docs = await getCollection('docs');
	return docs.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}) satisfies GetStaticPaths;

// Built URLs of images in src/assets, so Markdown image references resolve outside the site.
const assets = import.meta.glob<{ default: ImageMetadata }>('../assets/*', { eager: true });
const assetUrls = Object.fromEntries(
	Object.entries(assets).map(([path, mod]) => [path.split('/').pop()!, mod.default.src])
);

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = ({ props, site }) => {
	const { entry } = props;
	const body = (entry.body ?? '').replace(
		/\]\((?:\.\.\/)+assets\/([^)\s]+)\)/g,
		(match, file: string) => (assetUrls[file] ? `](${new URL(assetUrls[file], site)})` : match)
	);
	const header = `# ${entry.data.title}\n\n> ${entry.data.description ?? ''}\n\n`;
	return new Response(header + body.trim() + '\n', {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
};
