// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// Placeholder domain: change it to the real one before deploying.
// It is used for absolute URLs in llms.txt, the sitemap and canonical links.
const site = 'https://mantou.dev';

// https://astro.build/config
export default defineConfig({
	site,
	integrations: [
		starlight({
			title: 'Mantou',
			description: 'Native desktop apps in TypeScript, on Bun.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/dunkbing/mantou' }],
			routeMiddleware: './src/routeData.ts',
			sidebar: [
				{
					label: 'Design',
					items: [
						'design/overview',
						'design/threading',
						'design/native-core',
						'design/runtime',
						'design/protocols',
						'design/rendering',
						'design/ffi',
						'design/testing',
						'design/roadmap',
						'design/decisions',
					],
				},
				{
					label: 'Progress',
					items: ['progress/m0', 'progress/m1'],
				},
			],
			plugins: [
				starlightLlmsTxt({
					projectName: 'Mantou',
					description:
						'Mantou is a native GUI framework for Bun + TypeScript. Apps are written in TypeScript/TSX and run in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on the main thread and draws the UI itself on the GPU with wgpu. It never shows a webview.',
					details:
						'Mantou is in early development: the M0 threading spike passes on Linux, macOS and Windows, and M1 (op protocol, shadow tree, layout, rectangle renderer) is under way; there is no text yet. The design pages describe the planned architecture. Every page is also available as raw Markdown by appending `.md` to its path (for example `/design/protocols.md`).',
					promote: ['index*', 'design/overview*'],
					customSets: [
						{
							label: 'Design',
							description: 'the architecture and design of Mantou',
							paths: ['design/**'],
						},
						{
							label: 'Progress',
							description: 'milestone results: M0 (threading spike) and M1 (tree and ops)',
							paths: ['progress/**'],
						},
					],
					optionalLinks: [
						{
							label: 'M0 report (Linux)',
							url: `${site}/m0/report-linux.json`,
							description: 'raw JSON output of the M0 self-test',
						},
						{ label: 'Source code', url: 'https://github.com/dunkbing/mantou' },
					],
					// Drop Starlight's "Section titled …" heading anchor links from every output.
					customSelectors: { all: ['.sl-anchor-link'] },
				}),
			],
		}),
	],
});
