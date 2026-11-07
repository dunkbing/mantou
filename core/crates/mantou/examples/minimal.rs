//! The counter on the docs' Rust page (guide/rust.md), kept here so it always compiles.
use mantou::{Event, Length, Ops, Value, WindowOptions, protocol::{Prop, align_items, event_mask, justify_content, pointer_events}};

const ROOT: u32 = 1;
const COUNT: u32 = 2;
const BUTTON: u32 = 3;
const LABEL: u32 = 4;

fn main() {
    let options = WindowOptions { title: "Counter".into(), width: 360, height: 240, ..Default::default() };
    std::process::exit(mantou::run(options, |window| {
        // The UI, once. Ids are yours to choose; 0 means none.
        let mut ops = Ops::new();
        ops.create(ROOT)
            .style(ROOT, Prop::FlexGrow, Value::F32(1.0))
            .style(ROOT, Prop::AlignItems, Value::Enum(align_items::CENTER))
            .style(ROOT, Prop::JustifyContent, Value::Enum(justify_content::CENTER))
            .style(ROOT, Prop::RowGap, Value::Length(Length::Px(16.0)))
            .create_text(COUNT)
            .text(COUNT, "0")
            .style(COUNT, Prop::FontSize, Value::F32(40.0))
            .create(BUTTON)
            .style(BUTTON, Prop::Width, Value::Length(Length::Px(120.0)))
            .style(BUTTON, Prop::Height, Value::Length(Length::Px(40.0)))
            .style(BUTTON, Prop::BorderRadius, Value::F32(8.0))
            .style(BUTTON, Prop::BackgroundColor, Value::Color(0xffeb6325)) // RGBA8, red in the low byte: #2563eb
            .listen(BUTTON, event_mask::PRESS)
            .create_text(LABEL)
            .text(LABEL, "+1")
            .style(LABEL, Prop::PointerEvents, Value::Enum(pointer_events::NONE))
            .insert(BUTTON, LABEL, 0)
            .insert(ROOT, COUNT, 0)
            .insert(ROOT, BUTTON, 0)
            .set_root(ROOT);
        window.commit(&mut ops).unwrap();

        let mut count = 0;
        loop {
            for event in window.wait() {
                match event {
                    Event::Press { target: BUTTON, .. } => {
                        count += 1;
                        ops.text(COUNT, &count.to_string());
                    }
                    Event::CloseRequested => return window.quit(0),
                    _ => {}
                }
            }
            window.commit(&mut ops).unwrap(); // what the events changed, in one batch
        }
    }));
}
