---
title: HTML documents
description: "Static HTML/CSS (HTML mail) laid out by Blitz in the core, drawn in bands, with images from the app and links that never navigate."
---

[#74](https://github.com/dunkbing/mantou/issues/74). `<Html>` shows a static HTML/CSS document without a browser engine. The `mantou-html` crate wraps [Blitz](https://github.com/DioxusLabs/blitz) 0.3.0-beta.4: html5ever parses the document, Stylo styles it, and Taffy and Parley lay it out. These are the same Taffy (0.15) and Parley (0.12) as the core's, and it uses the same fonts (the bundled Inter, then the system's). It's painted on the CPU with vello_cpu.

- **A node like the others:** the tree measures an Html node like text, so it's as tall as its document at the width it gets. In the scene it's image quads, one per 512 px band of the document that shows (in the window, inside its clip). A band is painted when it first shows and kept while it shows and nothing changed. Scrolling past a long mail paints the new bands only, and a document never needs a texture taller than a band.
- **Nothing is fetched:** Blitz's network provider is the core's. A request becomes an `HTML_REQUEST` event to JS, the app's `loadImage` answers, and `HTML_RESOURCE` brings the bytes back, or nothing. `data:` URLs are decoded in the core. The image crate is built with PNG, JPEG, GIF and WebP; SVG goes through usvg.
- **Links:** `onLink` listens for presses on the node and asks the core for the `href` under the pointer (`mt_html_link_at`, ABI 16). The cursor over a link is the pointer hand.
- **Cost:** Stylo adds about 3 minutes to a clean release build, and the core library grows from about 21 to 36 MB stripped.

| What | Where it's tested |
|---|---|
| Height follows the content and the width; a band paints its part; links found where they're drawn; `prefers-color-scheme`; images asked for once, `data:` not | `core/crates/mantou-html` unit tests |
| Drawn where the node is; `loadImage` once per URL, the height follows the image; without a loader nothing loads; `onLink` and the cursor; in a `<Scroll>`: clipped, one band showing, two after scrolling; `colorScheme` | `tests/html.test.tsx` |
| The mail reader: remote images blocked until "Load images", then asked for | `examples/mail/MailReader.test.tsx` |

Not done: text selection and copying, one-sided cell borders in `border-collapse: collapse` tables (a Blitz gap), the `border` attribute on tables, and drawing documents through the GPU renderer instead of the CPU.
