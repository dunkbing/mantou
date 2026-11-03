// The Babel presets ship no types; the plugin only passes them to Babel.
declare module "babel-preset-solid" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}
declare module "@babel/preset-typescript" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}
