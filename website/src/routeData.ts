import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

// Advertise each page's raw Markdown version (served by src/pages/[...slug].md.ts)
// with <link rel="alternate" type="text/markdown">.
export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const id = route.entry.id || 'index';
	if (id === '404') return;
	route.head.push({
		tag: 'link',
		attrs: {
			rel: 'alternate',
			type: 'text/markdown',
			href: new URL(`/${id}.md`, context.site).href,
		},
	});
});
