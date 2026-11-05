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
        Value::Family(f) => json!(f),
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
        Op::Text { id, text } => json!({"op": "TEXT", "id": id, "text": text}),
        Op::Value { id, rev, text } => json!({"op": "VALUE", "id": id, "rev": rev, "text": text}),
        Op::InputAllow { id, allow } => json!({"op": "INPUT_ALLOW", "id": id, "allow": allow}),
        Op::Placeholder { id, text } => json!({"op": "PLACEHOLDER", "id": id, "text": text}),
        Op::InputOptions { id, flags, max_length } => json!({"op": "INPUT_OPTIONS", "id": id, "flags": flags, "maxLength": max_length}),
        Op::Access { id, role, flags, label } => json!({"op": "ACCESS", "id": id, "role": role, "flags": flags, "label": label}),
        Op::Focus { id } => json!({"op": "FOCUS", "id": id}),
        Op::Transition { id, prop, duration, easing } => json!({"op": "TRANSITION", "id": id, "prop": prop.name(), "duration": *duration as f64, "easing": easing}),
        Op::Select { id, anchor, focus } => json!({"op": "SELECT", "id": id, "anchor": anchor, "focus": focus}),
        Op::Focusable { id, flags, order } => json!({"op": "FOCUSABLE", "id": id, "flags": flags, "order": order}),
        Op::TextRuns { id, runs } => json!({"op": "TEXT_RUNS", "id": id, "runs": runs.iter().map(|(len, spans)| json!({"length": len, "spans": spans})).collect::<Vec<_>>()}),
        Op::Canvas { id, commands } => json!({"op": "CANVAS", "id": id, "commands": commands}),
        Op::Keyframes { id, animation, values } => json!({"op": "KEYFRAMES", "id": id, "animation": animation, "values": values}),
        Op::Animate { id, animation, prop, from, to, duration, easing, iterations, flags } => json!({"op": "ANIMATE", "id": id, "animation": animation, "prop": prop.name(), "from": from, "to": to, "duration": *duration as f64, "easing": easing, "iterations": *iterations as f64, "flags": flags}),
        Op::WindowSize { width, height } => json!({"op": "WINDOW_SIZE", "width": *width as f64, "height": *height as f64}),
        Op::WindowLimits { min, max, flags } => json!({"op": "WINDOW_LIMITS", "minWidth": min[0] as f64, "minHeight": min[1] as f64, "maxWidth": max[0] as f64, "maxHeight": max[1] as f64, "flags": flags}),
        Op::ImagePath { id, path } => json!({"op": "IMAGE_PATH", "id": id, "path": path}),
        Op::ImageData { id, data } => json!({"op": "IMAGE_DATA", "id": id, "bytes": data.len()}),
        Op::Font(data) => json!({"op": "FONT", "bytes": data.len()}),
        Op::FontFamily { family, names } => json!({"op": "FONT_FAMILY", "family": family, "names": names}),
        Op::FocusScope { id, flags } => json!({"op": "FOCUS_SCOPE", "id": id, "flags": flags}),
        Op::ScrollTo { id, x, y, flags } => json!({"op": "SCROLL_TO", "id": id, "x": *x as f64, "y": *y as f64, "flags": flags}),
        Op::ScrollIntoView { id, block } => json!({"op": "SCROLL_INTO_VIEW", "id": id, "block": block}),
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
    for code in 1..=29 {
        let name = mantou_tree::protocol::op_name(code);
        assert!(seen.contains(&name), "fixture has no {name}");
    }
}
