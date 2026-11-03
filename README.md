# Mantou

Native desktop apps in TypeScript, on Bun. Your app runs in a Bun Worker; a Rust core loaded with `bun:ffi` owns the window and draws the UI on the GPU with wgpu. No webview.

> **Early development.** The threading model works on Linux, macOS and Windows. The op protocol, flexbox layout, a rectangle renderer and presses work. There's no text yet.

## Try it

Needs [Bun](https://bun.sh) 1.4.4 and [Rust](https://rustup.rs).

```bash
bun install
```

```bash
bun run build:core
```

```bash
bun run counter
```

## Docs

The design, the protocol and test results are in [`website/`](website/) (Astro + Starlight, on Bun):

```bash
bun run docs
```

Working on the code, as a person or an agent? Start with [AGENTS.md](AGENTS.md).
