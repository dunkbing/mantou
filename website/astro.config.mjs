// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// Absolute URLs in llms.txt, the sitemap (sitemap-index.xml, written by
// Starlight from `site`) and canonical links come from this.
const site = 'https://mantou.dunkbing.dev';

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
						'design/packaging',
						'design/decisions',
					],
				},
				{
					label: 'Status',
					items: ['progress/threading', 'progress/ui-tree', 'progress/text', 'progress/text-input', 'progress/scrolling'],
				},
			],
			plugins: [
				starlightLlmsTxt({
					projectName: 'Mantou',
					description:
						'Mantou is a native GUI framework for Bun + TypeScript. Apps are written in TypeScript/TSX and run in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on the main thread and draws the UI itself on the GPU with wgpu. It never shows a webview.',
					details:
						'Mantou is in early development. The threading model works on Linux, macOS and Windows; Solid-style JSX, flexbox layout, text, rounded corners and borders, clipping, keys, the wheel and headless test instances work; there is no text input yet. Mantou Mail (github.com/dunkbing/mantou-mail) is a three-pane mail client built with it. The design pages describe the planned architecture. Every page is also available as raw Markdown by appending `.md` to its path (for example `/design/protocols.md`).',
					promote: ['index*', 'design/overview*'],
					customSets: [
						{
							label: 'Design',
							description: 'the architecture and design of Mantou',
							paths: ['design/**'],
						},
						{
							label: 'Status',
							description: 'test results: the threading model; the UI tree, layout and rendering; text and the Mantou Mail example',
							paths: ['progress/**'],
						},
					],
					optionalLinks: [
						{
							label: 'Threading self-test report (Linux)',
							url: `${site}/reports/threading-linux.json`,
							description: 'raw JSON output of the window self-test',
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
