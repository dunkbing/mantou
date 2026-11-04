// Solid's client build, typed as "solid-js". Bun resolves the bare `solid-js`
// to the server build (dist/server.js, through the package's "node" export
// condition), whose effects never re-run, and Bun's runtime plugins can't
// redirect bare imports. So Mantou imports the client build by path, and the
// JSX plugin rewrites `solid-js` imports in Solid's own subpackages and in app
// .tsx files (plugin.ts).
// @ts-expect-error: the client build has no declarations of its own; it's typed below.
import * as client from "solid-js/dist/solid.js";
import type * as SolidTypes from "solid-js";

const solid = client as typeof SolidTypes;

export const {
  createSignal,
  createMemo,
  createEffect,
  createComputed,
  createRenderEffect,
  createRoot,
  createContext,
  useContext,
  getOwner,
  runWithOwner,
  batch,
  untrack,
  on,
  onCleanup,
  onMount,
  For,
  Index,
  Show,
  Switch,
  Match,
  ErrorBoundary,
} = solid;
