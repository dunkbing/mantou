//! The TypeScript encoder writes schema/fixtures/*.bin and its decoder's view
//! of them as *.json (`bun run gen`). The Rust decoder must agree exactly.

use mantou_tree::{Length, Op, Value, decode, protocol::Prop};
use serde_json::{Value as J, json};

fn fixture(name: &str) -> (Vec<u8>, J) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../schema/fixtures/");
    let bin = std::fs::read(format!("{dir}{name}.bin")).expect("fixture .bin (run `bun run gen`)");
    let json = std::fs::read_to_string(format!("{dir}{name}.json")).expect("fixture .json");
    (bin, serde_json::from_str(&json).unwrap())
}

fn hex(c: u32) -> String {
    format!("#{:02x}{:02x}{:02x}{:02x}", c & 255, (c >> 8) & 255, (c >> 16) & 255, c >> 24)
}

/// The same readable form runtime/decode.ts produces.
fn value_json(prop: Prop, v: Value) -> J {
    match v {
        Value::F32(f) => json!(f as f64),
        Value::Color(c) => json!(hex(c)),
        Value::Length(Length::Px(f)) => json!(f as f64),
        Value::Length(Length::Percent(f)) => json!(format!("{}%", f)),
        Value::Length(Length::Auto) => json!("auto"),
        Value::Enum(e) => json!(prop.enum_names()[e as usize]),
    }
}

fn op_json(o: &Op) -> J {
    match o {
        Op::Create { id, kind } => json!({"op": "CREATE", "id": id, "kind": kind}),
        Op::Insert { parent, child, before } => json!({"op": "INSERT", "parent": parent, "child": child, "before": before}),
        Op::Remove { parent, child } => json!({"op": "REMOVE", "parent": parent, "child": child}),
        Op::Release { id } => json!({"op": "RELEASE", "id": id}),
        Op::Style { id, prop, value } => json!({"op": "STYLE", "id": id, "prop": prop.name(), "value": value_json(*prop, *value)}),
        Op::StyleReset { id, prop } => json!({"op": "STYLE_RESET", "id": id, "prop": prop.name()}),
        Op::StyleDef { style_id, props } => json!({"op": "STYLE_DEF", "styleId": style_id,
            "props": props.iter().map(|(p, v)| json!([p.name(), value_json(*p, *v)])).collect::<Vec<_>>()}),
        Op::StyleUse { id, style_id } => json!({"op": "STYLE_USE", "id": id, "styleId": style_id}),
        Op::Listen { id, mask } => json!({"op": "LISTEN", "id": id, "mask": mask}),
        Op::SetRoot { id } => json!({"op": "SET_ROOT", "id": id}),
        Op::ClearColor(c) => json!({"op": "CLEAR_COLOR", "r": c[0] as f64, "g": c[1] as f64, "b": c[2] as f64, "a": c[3] as f64}),
        Op::Title(t) => json!({"op": "TITLE", "title": t}),
        Op::Unknown { code } => json!({"op": format!("UNKNOWN_{code}")}),
    }
}

/// JSON from JS writes 24 for 24.0; compare numbers by value.
fn norm(v: &J) -> J {
    match v {
        J::Number(n) => json!(n.as_f64().unwrap()),
        J::Array(a) => J::Array(a.iter().map(norm).collect()),
        J::Object(o) => J::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
        other => other.clone(),
    }
}

#[test]
fn rust_decodes_what_typescript_encoded() {
    let (bin, expected) = fixture("basic");
    let ops = decode(&bin).expect("valid batch");
    let got: Vec<J> = ops.iter().map(op_json).collect();
    let expected = expected.as_array().unwrap();
    assert_eq!(got.len(), expected.len(), "op count");
    for (i, (g, e)) in got.iter().zip(expected).enumerate() {
        assert_eq!(norm(g), norm(e), "op {i}");
    }
}

#[test]
fn every_op_code_is_covered_by_the_fixture() {
    let (bin, _) = fixture("basic");
    let ops = decode(&bin).unwrap();
    let mut seen: Vec<&str> = ops.iter().map(|o| op_json(o)["op"].as_str().unwrap().to_string().leak() as &str).collect();
    seen.sort();
    seen.dedup();
    for code in 1..=12 {
        let name = mantou_tree::protocol::op_name(code);
        assert!(seen.contains(&name), "fixture has no {name}");
    }
}
