// Generates the protocol bindings from schema/protocol.ts:
//   runtime/gen/protocol.ts                      (TypeScript)
//   core/crates/mantou-tree/src/protocol.rs      (Rust)
//   schema/fixtures/*.bin + *.json               (cross-language round-trip fixtures)
//
//   bun run gen            write them
//   bun run gen --check    exit 1 if any is stale (CI)
import { join } from "node:path";
import { events, eventMask, focusScopeFlags, inputFlags, scrollBlocks, scrollFlags, keyModifiers, namedKeys, nodeKinds, ops, PROTOCOL_VERSION, styleProps, units, type ValueType } from "./protocol";

const root = join(import.meta.dir, "..");
const check = Bun.argv.includes("--check");
const HEADER = "Written by schema/gen.ts from schema/protocol.ts. Don't edit it; change the schema and run `bun run gen`.";

const camelToSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const camelToPascal = (s: string) => s[0].toUpperCase() + s.slice(1);
const screaming = (s: string) => camelToSnake(s).toUpperCase();
const kindOf = (t: ValueType) => (typeof t === "string" ? t : "enum");

// ---------------------------------------------------------------- TypeScript
function ts(): string {
  const L: string[] = [`// ${HEADER}`, "", `export const PROTOCOL_VERSION = ${PROTOCOL_VERSION};`, ""];
  L.push("export const Op = {");
  for (const o of ops) L.push(`  /** ${o.doc} */\n  ${o.name}: ${o.code},`);
  L.push("} as const;", "");
  L.push(`export const OpName: Record<number, string> = { ${ops.map((o) => `${o.code}: "${o.name}"`).join(", ")} };`, "");
  L.push(`export const NodeKind = ${JSON.stringify(nodeKinds)} as const;`);
  L.push(`export const EventMask = ${JSON.stringify(eventMask)} as const;`);
  L.push(`export const InputFlag = ${JSON.stringify(inputFlags)} as const;`);
  L.push(`export const FocusScopeFlag = ${JSON.stringify(focusScopeFlags)} as const;`);
  L.push(`export const ScrollFlag = ${JSON.stringify(scrollFlags)} as const;`);
  L.push(`export const ScrollBlock = ${JSON.stringify(scrollBlocks)} as const;`);
  L.push(`export const Unit = { ${units.map((u, i) => `${u}: ${i}`).join(", ")} } as const;`);
  L.push(`export const KeyModifier = ${JSON.stringify(keyModifiers)} as const;`);
  L.push(`export const NamedKey = ${JSON.stringify(namedKeys)} as const;`, "");
  L.push("export const Event = {");
  for (const e of events) L.push(`  /** ${e.doc}${e.fields ? ` ${e.fields}.` : ""} */\n  ${e.name}: ${e.code},`);
  L.push("} as const;", "");
  L.push("export type ValueKind = \"f32\" | \"color\" | \"length\" | \"enum\";");
  L.push("export const StyleProp = {");
  for (const p of styleProps) {
    const values = typeof p.type === "string" ? "" : `, values: ${JSON.stringify(p.type.enum)}`;
    L.push(`  ${p.name}: { code: ${p.code}, kind: "${kindOf(p.type)}"${values} },`);
  }
  L.push("} as const;");
  L.push("export type StylePropName = keyof typeof StyleProp;");
  L.push(`export const StylePropByCode: Record<number, StylePropName> = { ${styleProps.map((p) => `${p.code}: "${p.name}"`).join(", ")} };`, "");
  L.push("/** A length: logical pixels, a percentage string, or \"auto\". */");
  L.push("export type Length = number | `${number}%` | \"auto\";");
  L.push("/** A colour: \"#rgb\", \"#rrggbb\", \"#rrggbbaa\", \"transparent\", or [r, g, b, a?] with r, g, b in 0–255 and a in 0–1. */");
  L.push("export type Color = string | readonly [number, number, number] | readonly [number, number, number, number];", "");
  L.push("/** Style properties as the core understands them (one wire property each). */");
  L.push("export interface WireStyle {");
  for (const p of styleProps) {
    const t = p.type === "f32" ? "number" : p.type === "color" ? "Color" : p.type === "length" ? "Length" : p.type.enum.map((v) => `"${v}"`).join(" | ");
    L.push(`  /** Default: ${p.default}. */\n  ${p.name}?: ${t};`);
  }
  L.push("}", "");
  return L.join("\n");
}

// ---------------------------------------------------------------- Rust
function rs(): string {
  const L: string[] = [`//! ${HEADER}`, "", "#![allow(missing_docs, dead_code)]", "", `pub const PROTOCOL_VERSION: u32 = ${PROTOCOL_VERSION};`, ""];
  L.push("pub mod op {");
  for (const o of ops) L.push(`    /// ${o.doc}\n    pub const ${o.name}: u32 = ${o.code};`);
  L.push("}", "");
  L.push("pub fn op_name(code: u32) -> &'static str {", "    match code {");
  for (const o of ops) L.push(`        ${o.code} => "${o.name}",`);
  L.push(`        _ => "UNKNOWN",`, "    }", "}", "");
  L.push("pub mod node_kind {");
  for (const [k, v] of Object.entries(nodeKinds)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod event_mask {");
  for (const [k, v] of Object.entries(eventMask)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod scroll_flag {");
  for (const [k, v] of Object.entries(scrollFlags)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod scroll_block {");
  for (const [k, v] of Object.entries(scrollBlocks)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod focus_scope_flag {");
  for (const [k, v] of Object.entries(focusScopeFlags)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod input_flag {");
  for (const [k, v] of Object.entries(inputFlags)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod key_modifier {");
  for (const [k, v] of Object.entries(keyModifiers)) L.push(`    pub const ${screaming(k)}: u32 = ${v};`);
  L.push("}", "", "pub mod named_key {");
  for (const [k, v] of Object.entries(namedKeys)) L.push(`    pub const ${screaming(k)}: u32 = 0x${v.toString(16)};`);
  L.push("}", "", "pub mod unit {");
  units.forEach((u, i) => L.push(`    pub const ${screaming(u)}: u32 = ${i};`));
  L.push("}", "", "pub mod event {");
  for (const e of events) L.push(`    /// ${e.doc}${e.fields ? ` ${e.fields}.` : ""}\n    pub const ${e.name}: u32 = ${e.code};`);
  L.push("}", "");
  for (const p of styleProps) {
    if (typeof p.type === "string") continue;
    L.push(`pub mod ${camelToSnake(p.name)} {`);
    p.type.enum.forEach((v, i) => L.push(`    pub const ${screaming(v)}: u32 = ${i};`));
    L.push("}", "");
  }
  L.push("#[derive(Clone, Copy, Debug, PartialEq, Eq)]", "pub enum ValueKind {", "    F32,", "    Color,", "    Length,", "    /// An enum with this many values.", "    Enum(u32),", "}", "");
  L.push("#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]", "#[repr(u32)]", "pub enum Prop {");
  for (const p of styleProps) L.push(`    ${camelToPascal(p.name)} = ${p.code},`);
  L.push("}", "", "impl Prop {", `    pub const COUNT: usize = ${styleProps.length};`, "");
  L.push("    pub fn from_code(code: u32) -> Option<Prop> {", "        Some(match code {");
  for (const p of styleProps) L.push(`            ${p.code} => Prop::${camelToPascal(p.name)},`);
  L.push("            _ => return None,", "        })", "    }", "");
  L.push("    pub fn name(self) -> &'static str {", "        match self {");
  for (const p of styleProps) L.push(`            Prop::${camelToPascal(p.name)} => "${p.name}",`);
  L.push("        }", "    }", "");
  L.push("    pub fn kind(self) -> ValueKind {", "        match self {");
  for (const p of styleProps) {
    const k = p.type === "f32" ? "ValueKind::F32" : p.type === "color" ? "ValueKind::Color" : p.type === "length" ? "ValueKind::Length" : `ValueKind::Enum(${p.type.enum.length})`;
    L.push(`            Prop::${camelToPascal(p.name)} => ${k},`);
  }
  L.push("        }", "    }", "");
  L.push("    /// Names of an enum property's values, by index.", "    pub fn enum_names(self) -> &'static [&'static str] {", "        match self {");
  for (const p of styleProps) if (typeof p.type !== "string") L.push(`            Prop::${camelToPascal(p.name)} => &[${p.type.enum.map((v) => `"${v}"`).join(", ")}],`);
  L.push("            _ => &[],", "        }", "    }", "}", "");
  return L.join("\n");
}

// ---------------------------------------------------------------- fixtures
async function fixtures(): Promise<Record<string, Uint8Array | string>> {
  const { fixtureScenarios } = await import("./fixtures");
  const { decodeOps } = await import("../runtime/decode");
  const out: Record<string, Uint8Array | string> = {};
  for (const [name, bytes] of Object.entries(fixtureScenarios())) {
    out[`schema/fixtures/${name}.bin`] = bytes;
    out[`schema/fixtures/${name}.json`] = JSON.stringify(decodeOps(bytes), null, 2) + "\n";
  }
  return out;
}

async function rustfmt(code: string): Promise<string> {
  const p = Bun.spawn(["rustfmt", "--edition", "2024", "--emit", "stdout"], { stdin: new TextEncoder().encode(code), stdout: "pipe", stderr: "pipe" });
  const [outText, errText, status] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (status !== 0) throw new Error(`rustfmt failed: ${errText}`);
  return outText;
}

const files: Record<string, Uint8Array | string> = {
  "runtime/gen/protocol.ts": ts(),
  "core/crates/mantou-tree/src/protocol.rs": await rustfmt(rs()),
};
// Fixtures use the runtime's encoder, which imports the generated TypeScript:
// write that first when generating, so a schema change is picked up.
if (!check) for (const [p, c] of Object.entries(files)) await Bun.write(join(root, p), c);
Object.assign(files, await fixtures());

let stale = 0;
for (const [path, content] of Object.entries(files)) {
  const file = Bun.file(join(root, path));
  const want = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const have = (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null;
  const same = have !== null && have.length === want.length && have.every((b, i) => b === want[i]);
  if (same) continue;
  if (check) {
    console.error(`stale: ${path}`);
    stale++;
  } else {
    await Bun.write(join(root, path), want);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) {
  console.error(`\n${stale} generated file(s) are stale: run \`bun run gen\`.`);
  process.exit(1);
}
if (check) console.log("generated files are up to date");
