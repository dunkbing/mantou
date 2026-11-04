# Mantou website

The documentation site for Mantou, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

```bash
bun install        # install dependencies
bun run dev        # dev server at http://localhost:4321
bun run build      # static build into dist/
bun run preview    # serve dist/ locally
```

- Pages live in `src/content/docs/`. This site is the project's documentation: the design (`design/`) and test results (`progress/`). Edit the pages here; there is no other copy.
- `/llms.txt`, `/llms-full.txt` and `/llms-small.txt` are built by the `starlight-llms-txt` plugin.
- Every page is also served as raw Markdown at `/<page>.md` (e.g. `/design/protocols.md`) by `src/pages/[...slug].md.ts`, and advertised with `<link rel="alternate" type="text/markdown">` by `src/routeData.ts`.
- The site is https://mantou.dunkbing.dev (`site` in `astro.config.mjs`). Starlight generates `sitemap-index.xml` from it; `public/robots.txt` points crawlers at it.
- Cloudflare deploys `dist/` as static assets (`wrangler.jsonc`): build command `bun run build`, deploy command `npx wrangler deploy`, root directory `website`.
