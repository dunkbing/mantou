//! Decodes op batches (design §8.1). A batch is validated whole before
//! anything is applied: a malformed batch changes nothing.

use crate::protocol::{Prop, ValueKind, op, unit};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Length {
    Px(f32),
    /// Percent, 0–100.
    Percent(f32),
    Auto,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value {
    F32(f32),
    /// RGBA8, r in the low byte.
    Color(u32),
    Length(Length),
    /// Index into the property's enum values.
    Enum(u32),
    /// A FONT_FAMILY id (0 = the default fonts).
    Family(u32),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Create { id: u32, kind: u32 },
    Insert { parent: u32, child: u32, before: u32 },
    Remove { parent: u32, child: u32 },
    Release { id: u32 },
    Style { id: u32, prop: Prop, value: Value },
    StyleReset { id: u32, prop: Prop },
    StyleDef { style_id: u32, props: Vec<(Prop, Value)> },
    StyleUse { id: u32, style_id: u32 },
    Listen { id: u32, mask: u32 },
    SetRoot { id: u32 },
    ClearColor([f32; 4]),
    Title(String),
    Text { id: u32, text: String },
    Value { id: u32, rev: u32, text: String },
    Placeholder { id: u32, text: String },
    InputOptions { id: u32, flags: u32, max_length: u32 },
    Focus { id: u32 },
    FocusScope { id: u32, flags: u32 },
    Font(Vec<u8>),
    ImagePath { id: u32, path: String },
    ImageData { id: u32, data: Vec<u8> },
    WindowSize { width: f32, height: f32 },
    Transition { id: u32, prop: Prop, duration: f32, easing: u32 },
    Animate { id: u32, animation: u32, prop: Prop, from: u32, to: u32, duration: f32, easing: u32, iterations: f32, flags: u32 },
    /// An Input's selection, in UTF-16 code units.
    Select { id: u32, anchor: u32, focus: u32 },
    /// Logical px, 0 = no limit.
    WindowLimits { min: [f32; 2], max: [f32; 2], flags: u32 },
    FontFamily { family: u32, names: String },
    /// x or y NaN: keep that axis.
    ScrollTo { id: u32, x: f32, y: f32, flags: u32 },
    ScrollIntoView { id: u32, block: u32 },
    /// An op from a newer protocol: skipped, so old cores tolerate new runtimes.
    Unknown { code: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeError {
    /// Word offset of the op that failed.
    pub at: usize,
    pub message: String,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "op at word {}: {}", self.at, self.message)
    }
}

impl std::error::Error for DecodeError {}

fn err<T>(at: usize, message: impl Into<String>) -> Result<T, DecodeError> {
    Err(DecodeError { at, message: message.into() })
}

/// Decodes one value of `prop` from `w`, returning it and the words it used.
fn value(prop: Prop, w: &[u32], at: usize) -> Result<(Value, usize), DecodeError> {
    let need = if prop.kind() == ValueKind::Length { 2 } else { 1 };
    if w.len() < need {
        return err(at, format!("{} needs {need} value word(s)", prop.name()));
    }
    let finite = |v: f32| if v.is_finite() { Ok(v) } else { err(at, format!("{} is not finite", prop.name())) };
    let v = match prop.kind() {
        ValueKind::F32 => Value::F32(finite(f32::from_bits(w[0]))?),
        ValueKind::Color => Value::Color(w[0]),
        ValueKind::Family => Value::Family(w[0]),
        ValueKind::Enum(n) => {
            if w[0] >= n {
                return err(at, format!("{} has no value {}", prop.name(), w[0]));
            }
            Value::Enum(w[0])
        }
        ValueKind::Length => Value::Length(match w[0] {
            unit::PX => Length::Px(finite(f32::from_bits(w[1]))?),
            unit::PERCENT => Length::Percent(finite(f32::from_bits(w[1]))?),
            unit::AUTO => Length::Auto,
            u => return err(at, format!("{} has unknown unit {u}", prop.name())),
        }),
    };
    Ok((v, need))
}

fn prop(code: u32, at: usize) -> Result<Prop, DecodeError> {
    Prop::from_code(code).map_or_else(|| err(at, format!("unknown style property {code}")), Ok)
}

fn id_then_string(a: &[u32], at: usize, name: &str) -> Result<u32, DecodeError> {
    if a.len() < 2 {
        return err(at, format!("{name} needs an id and a length"));
    }
    Ok(a[0])
}

/// A string operand: at operand `k`, its byte length, then the bytes padded to
/// words, which must end the op. `start` is the word offset of the operands.
fn string(bytes: &[u8], a: &[u32], start: usize, k: usize, name: &str) -> Result<String, DecodeError> {
    let at = start - 1;
    let Some(&len) = a.get(k) else { return err(at, format!("{name} needs a length")) };
    let len = len as usize;
    if len.div_ceil(4) != a.len() - k - 1 {
        return err(at, format!("{name} length does not match its words"));
    }
    let from = (start + k + 1) * 4;
    match std::str::from_utf8(&bytes[from..from + len]) {
        Ok(s) => Ok(s.to_owned()),
        Err(_) => err(at, format!("{name} is not UTF-8")),
    }
}

pub fn decode(bytes: &[u8]) -> Result<Vec<Op>, DecodeError> {
    if bytes.len() % 4 != 0 {
        return err(0, "batch length is not a multiple of 4");
    }
    let w: Vec<u32> = bytes.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < w.len() {
        let code = w[i] & 0xffff;
        let n = (w[i] >> 16) as usize;
        let a = &w.get(i + 1..i + 1 + n).map_or_else(|| err(i, "operands overrun the batch"), Ok)?;
        let fixed = |count: usize| if n == count { Ok(()) } else { err(i, format!("{} takes {count} operand words, got {n}", crate::protocol::op_name(code))) };
        let o = match code {
            op::CREATE => {
                fixed(2)?;
                Op::Create { id: a[0], kind: a[1] }
            }
            op::INSERT => {
                fixed(3)?;
                Op::Insert { parent: a[0], child: a[1], before: a[2] }
            }
            op::REMOVE => {
                fixed(2)?;
                Op::Remove { parent: a[0], child: a[1] }
            }
            op::RELEASE => {
                fixed(1)?;
                Op::Release { id: a[0] }
            }
            op::STYLE => {
                if n < 3 {
                    return err(i, "STYLE needs an id, a property and a value");
                }
                let p = prop(a[1], i)?;
                let (v, used) = value(p, &a[2..], i)?;
                if 2 + used != n {
                    return err(i, "STYLE has extra words");
                }
                Op::Style { id: a[0], prop: p, value: v }
            }
            op::STYLE_RESET => {
                fixed(2)?;
                Op::StyleReset { id: a[0], prop: prop(a[1], i)? }
            }
            op::STYLE_DEF => {
                if n < 2 {
                    return err(i, "STYLE_DEF needs a style id and a count");
                }
                // Each property takes at least two words: check the count
                // before reserving for it (a fuzzed count of 2^32 would abort).
                if a[1] as usize > (n - 2) / 2 {
                    return err(i, format!("STYLE_DEF claims {} properties in {} words", a[1], n - 2));
                }
                let mut props = Vec::with_capacity(a[1] as usize);
                let mut j = 2;
                for _ in 0..a[1] {
                    let code = *a.get(j).map_or_else(|| err(i, "STYLE_DEF list overruns the op"), Ok)?;
                    let p = prop(code, i)?;
                    let (v, used) = value(p, &a[j + 1..], i)?;
                    props.push((p, v));
                    j += 1 + used;
                }
                if j != n {
                    return err(i, "STYLE_DEF has extra words");
                }
                Op::StyleDef { style_id: a[0], props }
            }
            op::STYLE_USE => {
                fixed(2)?;
                Op::StyleUse { id: a[0], style_id: a[1] }
            }
            op::LISTEN => {
                fixed(2)?;
                Op::Listen { id: a[0], mask: a[1] }
            }
            op::SET_ROOT => {
                fixed(1)?;
                Op::SetRoot { id: a[0] }
            }
            op::CLEAR_COLOR => {
                fixed(4)?;
                Op::ClearColor([0, 1, 2, 3].map(|k| f32::from_bits(a[k])))
            }
            op::TITLE => Op::Title(string(bytes, a, i + 1, 0, "TITLE")?),
            op::TEXT => Op::Text { id: id_then_string(a, i, "TEXT")?, text: string(bytes, a, i + 1, 1, "TEXT")? },
            op::PLACEHOLDER => Op::Placeholder { id: id_then_string(a, i, "PLACEHOLDER")?, text: string(bytes, a, i + 1, 1, "PLACEHOLDER")? },
            op::VALUE => {
                if n < 3 {
                    return err(i, "VALUE needs an id, a rev and a length");
                }
                Op::Value { id: a[0], rev: a[1], text: string(bytes, a, i + 1, 2, "VALUE")? }
            }
            op::INPUT_OPTIONS => {
                fixed(3)?;
                Op::InputOptions { id: a[0], flags: a[1], max_length: a[2] }
            }
            op::FOCUS => {
                fixed(1)?;
                Op::Focus { id: a[0] }
            }
            op::TRANSITION => {
                fixed(4)?;
                let duration = f32::from_bits(a[2]);
                if !duration.is_finite() || duration < 0.0 {
                    return err(i, "TRANSITION needs a finite duration of 0 or more");
                }
                Op::Transition { id: a[0], prop: prop(a[1], i)?, duration, easing: a[3] }
            }
            op::ANIMATE => {
                fixed(9)?;
                let (duration, iterations) = (f32::from_bits(a[5]), f32::from_bits(a[7]));
                if !duration.is_finite() || duration < 0.0 || iterations.is_nan() || iterations < 0.0 {
                    return err(i, "ANIMATE needs a finite duration and iterations of 0 or more");
                }
                Op::Animate { id: a[0], animation: a[1], prop: prop(a[2], i)?, from: a[3], to: a[4], duration, easing: a[6], iterations, flags: a[8] }
            }
            op::SELECT => {
                fixed(3)?;
                Op::Select { id: a[0], anchor: a[1], focus: a[2] }
            }
            op::WINDOW_SIZE => {
                fixed(2)?;
                let (w, h) = (f32::from_bits(a[0]), f32::from_bits(a[1]));
                if !(w.is_finite() && h.is_finite() && w >= 1.0 && h >= 1.0) {
                    return err(i, "WINDOW_SIZE needs a finite size of at least 1 × 1");
                }
                Op::WindowSize { width: w, height: h }
            }
            op::WINDOW_LIMITS => {
                fixed(5)?;
                let v: [f32; 4] = [0, 1, 2, 3].map(|k| f32::from_bits(a[k]));
                if v.iter().any(|x| !x.is_finite() || *x < 0.0) {
                    return err(i, "WINDOW_LIMITS needs finite sizes of 0 or more");
                }
                Op::WindowLimits { min: [v[0], v[1]], max: [v[2], v[3]], flags: a[4] }
            }
            op::IMAGE_PATH => Op::ImagePath { id: id_then_string(a, i, "IMAGE_PATH")?, path: string(bytes, a, i + 1, 1, "IMAGE_PATH")? },
            op::IMAGE_DATA => {
                if n < 2 {
                    return err(i, "IMAGE_DATA needs an id and a length");
                }
                let len = a[1] as usize;
                if len.div_ceil(4) != n - 2 {
                    return err(i, "IMAGE_DATA length does not match its words");
                }
                let from = (i + 3) * 4;
                Op::ImageData { id: a[0], data: bytes[from..from + len].to_vec() }
            }
            op::FONT => {
                let Some(&len) = a.first() else { return err(i, "FONT needs a length") };
                let len = len as usize;
                if len.div_ceil(4) != n - 1 {
                    return err(i, "FONT length does not match its words");
                }
                let from = (i + 2) * 4;
                Op::Font(bytes[from..from + len].to_vec())
            }
            op::FONT_FAMILY => {
                if n < 2 {
                    return err(i, "FONT_FAMILY needs a family id and a length");
                }
                Op::FontFamily { family: a[0], names: string(bytes, a, i + 1, 1, "FONT_FAMILY")? }
            }
            op::FOCUS_SCOPE => {
                fixed(2)?;
                Op::FocusScope { id: a[0], flags: a[1] }
            }
            op::SCROLL_TO => {
                fixed(4)?;
                let (x, y) = (f32::from_bits(a[1]), f32::from_bits(a[2]));
                if x.is_infinite() || y.is_infinite() {
                    return err(i, "SCROLL_TO offsets must be finite or NaN");
                }
                Op::ScrollTo { id: a[0], x, y, flags: a[3] }
            }
            op::SCROLL_INTO_VIEW => {
                fixed(2)?;
                Op::ScrollIntoView { id: a[0], block: a[1] }
            }
            _ => Op::Unknown { code },
        };
        out.push(o);
        i += 1 + n;
    }
    Ok(out)
}
