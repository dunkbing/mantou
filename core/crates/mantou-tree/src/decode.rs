//! Decodes op batches (DESIGN.md §8.1). A batch is validated whole before
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
            op::TITLE => {
                if n < 1 {
                    return err(i, "TITLE needs a length");
                }
                let len = a[0] as usize;
                if len.div_ceil(4) != n - 1 {
                    return err(i, "TITLE length does not match its words");
                }
                let start = (i + 2) * 4;
                match std::str::from_utf8(&bytes[start..start + len]) {
                    Ok(s) => Op::Title(s.to_owned()),
                    Err(_) => return err(i, "TITLE is not UTF-8"),
                }
            }
            _ => Op::Unknown { code },
        };
        out.push(o);
        i += 1 + n;
    }
    Ok(out)
}
