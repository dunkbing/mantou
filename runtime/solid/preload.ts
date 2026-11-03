// Registers the JSX plugin for this thread. The Worker entry imports it before
// the app; `bun test` preloads it (bunfig.toml).
import { plugin } from "bun";
import { mantouJsx } from "./plugin";

plugin(mantouJsx);
