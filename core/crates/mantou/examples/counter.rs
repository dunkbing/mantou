//! The counter, in Rust: a number and a button that adds one, in a native window, with no JavaScript.
//!
//!     cargo run --release -p mantou --example counter
use mantou::{Event, Ops, Value, WindowOptions, protocol::{Prop, align_items, event_mask, justify_content, pointer_events}};

const ROOT: u32 = 1;
const COUNT: u32 = 2;
const BUTTON: u32 = 3;
const LABEL: u32 = 4;

/// The UI, once: ids are the app's to choose.
pub fn build(ops: &mut Ops) {
    ops.create(ROOT)
        .style(ROOT, Prop::FlexGrow, Value::F32(1.0))
        .style(ROOT, Prop::AlignItems, Value::Enum(align_items::CENTER))
        .style(ROOT, Prop::JustifyContent, Value::Enum(justify_content::CENTER))
        .style(ROOT, Prop::RowGap, px(16.0))
        .style(ROOT, Prop::BackgroundColor, Value::Color(rgb(0xf8fafc)))
        .create_text(COUNT)
        .text(COUNT, "0")
        .style(COUNT, Prop::FontSize, Value::F32(40.0))
        .style(COUNT, Prop::FontWeight, Value::F32(700.0))
        .style(COUNT, Prop::Color, Value::Color(rgb(0x0f172a)))
        .create(BUTTON)
        .style(BUTTON, Prop::Width, px(120.0))
        .style(BUTTON, Prop::Height, px(40.0))
        .style(BUTTON, Prop::BorderRadius, Value::F32(8.0))
        .style(BUTTON, Prop::AlignItems, Value::Enum(align_items::CENTER))
        .style(BUTTON, Prop::JustifyContent, Value::Enum(justify_content::CENTER))
        .style(BUTTON, Prop::BackgroundColor, Value::Color(rgb(0x2563eb)))
        .listen(BUTTON, event_mask::PRESS)
        .create_text(LABEL)
        .text(LABEL, "+1")
        .style(LABEL, Prop::Color, Value::Color(rgb(0xffffff)))
        .style(LABEL, Prop::FontWeight, Value::F32(600.0))
        // A press's target is the innermost node under the pointer: the label lets presses through to the button.
        .style(LABEL, Prop::PointerEvents, Value::Enum(pointer_events::NONE))
        .insert(BUTTON, LABEL, 0)
        .insert(ROOT, COUNT, 0)
        .insert(ROOT, BUTTON, 0)
        .set_root(ROOT);
}

/// What an event does to the count: the ops to send, if any.
pub fn update(count: &mut u32, event: &Event, ops: &mut Ops) {
    if let Event::Press { target: BUTTON, .. } = event {
        *count += 1;
        ops.text(COUNT, &count.to_string());
    }
}

fn px(v: f32) -> Value {
    Value::Length(mantou::Length::Px(v))
}

/// 0xRRGGBB as the protocol's colour (RGBA8, red in the low byte).
fn rgb(c: u32) -> u32 {
    ((c >> 16) & 0xff) | (c & 0xff00) | ((c & 0xff) << 16) | 0xff00_0000
}

#[allow(dead_code)]
fn main() {
    let options = WindowOptions { title: "Counter".into(), width: 360, height: 240, ..Default::default() };
    std::process::exit(mantou::run(options, |window| {
        let mut ops = Ops::new();
        build(&mut ops);
        window.commit(&mut ops).expect("the first batch");
        let mut count = 0;
        loop {
            for event in window.wait() {
                if event == Event::CloseRequested {
                    return window.quit(0);
                }
                update(&mut count, &event, &mut ops);
            }
            window.commit(&mut ops).expect("a batch");
        }
    }));
}
