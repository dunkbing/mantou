//! Builds op batches the way runtime/encoder.ts does, for Rust tests, fuzzing
//! and tools. Each op is `code | operandWords << 16`, then its operands.

use crate::decode::{Length, Value};
use crate::protocol::{Prop, op, unit};

/// The words a value takes after its property code.
pub fn value_words(v: Value) -> Vec<u32> {
    match v {
        Value::F32(f) => vec![f.to_bits()],
        Value::Color(c) => vec![c],
        Value::Enum(e) | Value::Family(e) => vec![e],
        Value::Length(Length::Px(f)) => vec![unit::PX, f.to_bits()],
        Value::Length(Length::Percent(f)) => vec![unit::PERCENT, f.to_bits()],
        Value::Length(Length::Auto) => vec![unit::AUTO, 0],
    }
}

/// A string operand: its UTF-8 byte length, then the bytes padded to words.
pub fn string_words(text: &str) -> Vec<u32> {
    let bytes = text.as_bytes();
    let mut padded = bytes.to_vec();
    padded.resize(bytes.len().div_ceil(4) * 4, 0);
    let mut w = vec![bytes.len() as u32];
    w.extend(padded.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])));
    w
}

/// An op batch under construction.
#[derive(Clone, Debug, Default)]
pub struct Ops {
    words: Vec<u32>,
    count: usize,
}

impl Ops {
    pub fn new() -> Ops {
        Ops::default()
    }

    /// Appends a raw op.
    pub fn op(&mut self, code: u32, operands: &[u32]) -> &mut Self {
        self.words.push(code | (operands.len() as u32) << 16);
        self.words.extend_from_slice(operands);
        self.count += 1;
        self
    }

    pub fn create(&mut self, id: u32) -> &mut Self {
        self.op(op::CREATE, &[id, crate::protocol::node_kind::VIEW])
    }
    pub fn insert(&mut self, parent: u32, child: u32, before: u32) -> &mut Self {
        self.op(op::INSERT, &[parent, child, before])
    }
    pub fn remove(&mut self, parent: u32, child: u32) -> &mut Self {
        self.op(op::REMOVE, &[parent, child])
    }
    pub fn release(&mut self, id: u32) -> &mut Self {
        self.op(op::RELEASE, &[id])
    }
    pub fn style(&mut self, id: u32, prop: Prop, value: Value) -> &mut Self {
        let mut w = vec![id, prop as u32];
        w.extend(value_words(value));
        self.op(op::STYLE, &w)
    }
    pub fn style_reset(&mut self, id: u32, prop: Prop) -> &mut Self {
        self.op(op::STYLE_RESET, &[id, prop as u32])
    }
    pub fn style_def(&mut self, style_id: u32, props: &[(Prop, Value)]) -> &mut Self {
        let mut w = vec![style_id, props.len() as u32];
        for &(p, v) in props {
            w.push(p as u32);
            w.extend(value_words(v));
        }
        self.op(op::STYLE_DEF, &w)
    }
    pub fn style_use(&mut self, id: u32, style_id: u32) -> &mut Self {
        self.op(op::STYLE_USE, &[id, style_id])
    }
    pub fn listen(&mut self, id: u32, mask: u32) -> &mut Self {
        self.op(op::LISTEN, &[id, mask])
    }
    pub fn create_text(&mut self, id: u32) -> &mut Self {
        self.op(op::CREATE, &[id, crate::protocol::node_kind::TEXT])
    }
    pub fn text(&mut self, id: u32, text: &str) -> &mut Self {
        let mut w = vec![id];
        w.extend(string_words(text));
        self.op(op::TEXT, &w)
    }
    pub fn create_input(&mut self, id: u32) -> &mut Self {
        self.op(op::CREATE, &[id, crate::protocol::node_kind::INPUT])
    }
    pub fn value(&mut self, id: u32, rev: u32, text: &str) -> &mut Self {
        let mut w = vec![id, rev];
        w.extend(string_words(text));
        self.op(op::VALUE, &w)
    }
    pub fn placeholder(&mut self, id: u32, text: &str) -> &mut Self {
        let mut w = vec![id];
        w.extend(string_words(text));
        self.op(op::PLACEHOLDER, &w)
    }
    pub fn input_options(&mut self, id: u32, flags: u32, max_length: u32) -> &mut Self {
        self.op(op::INPUT_OPTIONS, &[id, flags, max_length])
    }
    pub fn focus(&mut self, id: u32) -> &mut Self {
        self.op(op::FOCUS, &[id])
    }
    pub fn font(&mut self, data: &[u8]) -> &mut Self {
        let mut padded = data.to_vec();
        padded.resize(data.len().div_ceil(4) * 4, 0);
        let mut w = vec![data.len() as u32];
        w.extend(padded.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])));
        self.op(op::FONT, &w)
    }
    pub fn font_family(&mut self, family: u32, names: &str) -> &mut Self {
        let mut w = vec![family];
        w.extend(string_words(names));
        self.op(op::FONT_FAMILY, &w)
    }
    pub fn focus_scope(&mut self, id: u32, flags: u32) -> &mut Self {
        self.op(op::FOCUS_SCOPE, &[id, flags])
    }
    pub fn scroll_to(&mut self, id: u32, x: f32, y: f32, flags: u32) -> &mut Self {
        self.op(op::SCROLL_TO, &[id, x.to_bits(), y.to_bits(), flags])
    }
    pub fn scroll_into_view(&mut self, id: u32, block: u32) -> &mut Self {
        self.op(op::SCROLL_INTO_VIEW, &[id, block])
    }
    pub fn set_root(&mut self, id: u32) -> &mut Self {
        self.op(op::SET_ROOT, &[id])
    }

    /// Ops in the batch.
    pub fn len(&self) -> usize {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    /// Returns the batch's bytes and starts a new one.
    pub fn take(&mut self) -> Vec<u8> {
        let b = self.bytes();
        self.words.clear();
        self.count = 0;
        b
    }
}
