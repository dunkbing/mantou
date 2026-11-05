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
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{ label: 'Guide', items: ['guide/getting-started', 'guide/components', 'guide/styling', 'guide/events', 'guide/platform', 'guide/testing', 'guide/shipping'] },
				{
					label: 'How it works',
					collapsed: true,
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
					label: 'Status and test results',
					collapsed: true,
					items: ['progress/threading', 'progress/ui-tree', 'progress/text', 'progress/text-input', 'progress/scrolling', 'progress/animations', 'progress/hover', 'progress/pointer-events', 'progress/drag-and-drop', 'progress/platform-services', 'progress/crash-reports', 'progress/accessibility', 'progress/macos'],
				},
			],
			plugins: [
				starlightLlmsTxt({
					projectName: 'Mantou',
					description:
						'Mantou is a native GUI framework for Bun + TypeScript. Apps are written in TypeScript/TSX and run in a Bun Worker; a Rust core loaded with `bun:ffi` owns the OS event loop on the main thread and draws the UI itself on the GPU with wgpu. It never shows a webview.',
					details:
						'Mantou is in early development and works on Linux, macOS and Windows: flexbox layout, text and custom fonts, text input with IME, scrolling and virtualized lists, images and SVG, shadows, animations, hover and pointer events, drag and drop, menus, dialogs, clipboard, accessibility, and headless tests. The Guide pages show how to build an app; the other pages describe how it works and what was tested. Mantou Mail (github.com/dunkbing/mantou-mail) is an email client built with it. Every page is also available as raw Markdown by appending `.md` to its path.',
					promote: ['index*', 'guide/getting-started*'],
					customSets: [
						{
							label: 'Guide',
							description: 'how to build an app with Mantou',
							paths: ['guide/**'],
						},
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
