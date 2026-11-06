use mantou_tree::protocol::{Prop, input_flag, key_modifier as m, named_key as k};
use mantou_tree::{TreeEvent, Length, MemoryClipboard, Ops, Tree, Value};

fn px(v: f32) -> Value {
    Value::Length(Length::Px(v))
}

/// A column with a single-line input (2), a multiline one (3) and a view (4)
/// to click away on. Key bindings are the non-macOS ones, so the tests are the
/// same everywhere.
fn tree() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create_input(2)
        .style(2, Prop::Width, px(160.0))
        .style(2, Prop::PaddingLeft, px(8.0))
        .style(2, Prop::PaddingTop, px(6.0))
        .style(2, Prop::PaddingBottom, px(6.0))
        .placeholder(2, "Search")
        .create_input(3)
        .input_options(3, input_flag::MULTILINE, 0)
        .style(3, Prop::Width, px(160.0))
        .create(4)
        .style(4, Prop::Height, px(40.0))
        .insert(1, 2, 0)
        .insert(1, 3, 0)
        .insert(1, 4, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.set_mac_keys(false);
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

fn center(t: &Tree, id: u32) -> (f32, f32) {
    let r = t.rect(id).unwrap();
    ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0)
}

fn click(t: &mut Tree, id: u32) {
    let (x, y) = center(t, id);
    t.pointer_down(x, y, 1, false);
    t.pointer_up();
}

fn type_str(t: &mut Tree, s: &str) {
    let mut cb = MemoryClipboard::default();
    for c in s.chars() {
        t.key(c as u32, Some(&c.to_string()), 0, &mut cb);
    }
}

fn changes(events: &[TreeEvent]) -> Vec<(u32, String)> {
    events.iter().filter_map(|e| if let TreeEvent::Changed { rev, text, .. } = e { Some((*rev, text.clone())) } else { None }).collect()
}

#[test]
fn an_input_is_one_line_tall_and_has_a_default_width() {
    let mut o = Ops::new();
    o.create(1).style(1, Prop::AlignItems, Value::Enum(1)).create_input(2).insert(1, 2, 0).set_root(1);
    let mut t = Tree::new();
    t.apply(&o.bytes()).unwrap();
    t.layout();
    let r = t.rect(2).unwrap();
    assert_eq!(r[2] - r[0], 200.0);
    assert!(r[3] - r[1] > 14.0 && r[3] - r[1] < 22.0, "{r:?}");
}

#[test]
fn clicking_focuses_typing_edits_and_clicking_away_blurs() {
    let mut t = tree();
    click(&mut t, 2);
    assert_eq!(t.focused(), Some(2));
    assert_eq!(t.take_events(), vec![TreeEvent::Focus(2)]);
    type_str(&mut t, "hi");
    assert_eq!(t.value_of(2).as_deref(), Some("hi"));
    assert_eq!(changes(&t.take_events()), vec![(1, "h".into()), (2, "hi".into())]);
    click(&mut t, 4);
    assert_eq!(t.focused(), None);
    assert_eq!(t.take_events(), vec![TreeEvent::Blur(2)]);
    type_str(&mut t, "x");
    assert_eq!(t.value_of(2).as_deref(), Some("hi"), "keys go nowhere without focus");
}

#[test]
fn keys_the_input_uses_are_consumed_and_others_are_not() {
    let mut t = tree();
    click(&mut t, 2);
    let mut cb = MemoryClipboard::default();
    assert!(t.key('a' as u32, Some("a"), 0, &mut cb));
    assert!(t.key(k::ARROW_LEFT, None, 0, &mut cb));
    assert!(t.key(k::BACKSPACE, None, 0, &mut cb));
    assert!(!t.key(k::ESCAPE, None, 0, &mut cb), "Escape is the app's");
    assert!(!t.key(k::ARROW_DOWN, None, 0, &mut cb), "single-line inputs leave Up and Down to the app");
    assert!(!t.key('k' as u32, Some("k"), m::CONTROL, &mut cb), "unknown shortcuts are the app's");
    assert!(t.key(k::ENTER, None, 0, &mut cb));
    assert!(t.take_events().contains(&TreeEvent::Submit(2)));
}

#[test]
fn shortcuts_select_copy_cut_paste_and_undo() {
    let mut t = tree();
    click(&mut t, 2);
    type_str(&mut t, "hello world");
    let mut cb = MemoryClipboard::default();
    t.key(k::BACKSPACE, None, m::CONTROL, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some("hello "), "Ctrl+Backspace deletes a word");
    t.key('a' as u32, None, m::CONTROL, &mut cb);
    t.key('c' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(cb.0, "hello ");
    t.key('x' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some(""));
    t.key('v' as u32, None, m::CONTROL, &mut cb);
    t.key('v' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some("hello hello "));
    t.key('z' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some("hello "));
    t.key('z' as u32, None, m::CONTROL | m::SHIFT, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some("hello hello "));
    t.key(k::HOME, None, m::SHIFT, &mut cb);
    t.key(k::DELETE, None, 0, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some(""));
}

#[test]
fn enter_adds_a_line_to_a_multiline_input_which_grows() {
    let mut t = tree();
    let before = t.rect(3).unwrap();
    click(&mut t, 3);
    type_str(&mut t, "one");
    let mut cb = MemoryClipboard::default();
    t.key(k::ENTER, None, 0, &mut cb);
    type_str(&mut t, "two");
    assert_eq!(t.value_of(3).as_deref(), Some("one\ntwo"));
    t.layout();
    let after = t.rect(3).unwrap();
    assert!(after[3] - after[1] > 1.5 * (before[3] - before[1]), "{before:?} -> {after:?}");
    t.key(k::ENTER, None, m::CONTROL, &mut cb);
    assert!(t.take_events().contains(&TreeEvent::Submit(3)), "Ctrl+Enter submits");
    assert!(t.key(k::ARROW_UP, None, 0, &mut cb), "multiline inputs use Up");
}

#[test]
fn tab_moves_the_focus_through_inputs_in_order() {
    let mut t = tree();
    let mut cb = MemoryClipboard::default();
    assert!(t.key(k::TAB, None, 0, &mut cb), "nothing focused: Tab goes to the first input");
    assert_eq!(t.focused(), Some(2));
    t.take_events();
    assert!(t.key(k::TAB, None, 0, &mut cb));
    assert_eq!(t.focused(), Some(3));
    t.key(k::TAB, None, 0, &mut cb);
    assert_eq!(t.focused(), Some(2), "wraps around");
    t.key(k::TAB, None, m::SHIFT, &mut cb);
    assert_eq!(t.focused(), Some(3));
    assert_eq!(t.take_events(), vec![
        TreeEvent::Blur(2), TreeEvent::Focus(3), TreeEvent::Blur(3), TreeEvent::Focus(2), TreeEvent::Blur(2), TreeEvent::Focus(3)
    ]);
}

#[test]
fn values_from_the_app_apply_unless_the_user_typed_since() {
    let mut t = tree();
    let mut o = Ops::new();
    o.value(2, 0, "draft").focus(2);
    t.apply(&o.take()).unwrap();
    assert_eq!(t.value_of(2).as_deref(), Some("draft"));
    assert_eq!(t.focused(), Some(2));
    assert_eq!(t.selection_of(2), Some((5, 5)), "the caret goes to the end");
    t.take_events();
    type_str(&mut t, "!");
    assert_eq!(changes(&t.take_events()), vec![(1, "draft!".into())]);
    // The app transforms what it saw (rev 1): applied.
    o.value(2, 1, "DRAFT!");
    t.apply(&o.take()).unwrap();
    assert_eq!(t.value_of(2).as_deref(), Some("DRAFT!"));
    type_str(&mut t, "?");
    // A value derived from rev 1 arrives after rev 2: stale, ignored.
    o.value(2, 1, "stale");
    t.apply(&o.take()).unwrap();
    assert_eq!(t.value_of(2).as_deref(), Some("DRAFT!?"));
    // FOCUS 0 blurs.
    o.focus(0);
    t.apply(&o.take()).unwrap();
    assert_eq!(t.focused(), None);
}

#[test]
fn max_length_and_read_only_options() {
    let mut t = tree();
    let mut o = Ops::new();
    o.input_options(2, 0, 3);
    t.apply(&o.take()).unwrap();
    click(&mut t, 2);
    type_str(&mut t, "abcdef");
    assert_eq!(t.value_of(2).as_deref(), Some("abc"));
    o.input_options(2, input_flag::READ_ONLY, 0);
    t.apply(&o.take()).unwrap();
    type_str(&mut t, "z");
    let mut cb = MemoryClipboard::default();
    t.key(k::BACKSPACE, None, 0, &mut cb);
    assert_eq!(t.value_of(2).as_deref(), Some("abc"));
    t.key('a' as u32, None, m::CONTROL, &mut cb);
    t.key('c' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(cb.0, "abc", "read-only text can still be copied");
}

#[test]
fn double_click_selects_a_word_and_dragging_extends_the_selection() {
    let mut t = tree();
    let mut o = Ops::new();
    o.value(2, 0, "alpha beta");
    t.apply(&o.take()).unwrap();
    t.layout();
    let r = t.rect(2).unwrap();
    let y = (r[1] + r[3]) / 2.0;
    t.pointer_down(r[0] + 10.0, y, 1, false);
    t.pointer_down(r[0] + 10.0, y, 2, false);
    t.pointer_up();
    assert_eq!(t.selection_of(2), Some((0, 5)), "alpha");
    t.pointer_down(r[0] + 8.0, y, 1, false);
    t.pointer_drag(r[2] - 1.0, y);
    t.pointer_up();
    assert_eq!(t.selection_of(2), Some((0, 10)));
}

#[test]
fn the_scene_draws_the_placeholder_the_caret_and_the_selection() {
    let mut t = tree();
    let glyphs = |t: &mut Tree| t.scene().quads.iter().filter(|q| q.is_glyph()).count();
    assert_eq!(glyphs(&mut t), 6, "the placeholder, \"Search\"");
    let rects = |t: &mut Tree| t.scene().quads.iter().filter(|q| !q.is_glyph()).count();
    let before = rects(&mut t);
    click(&mut t, 2);
    assert_eq!(rects(&mut t), before + 1, "the caret");
    type_str(&mut t, "ab");
    assert_eq!(glyphs(&mut t), 2);
    let mut cb = MemoryClipboard::default();
    t.key('a' as u32, None, m::CONTROL, &mut cb);
    assert_eq!(rects(&mut t), before + 1, "the selection, and no caret");
    click(&mut t, 4);
    assert_eq!(rects(&mut t), before, "unfocused: neither");
}

#[test]
fn ime_composition_is_drawn_underlined_then_committed() {
    let mut t = tree();
    click(&mut t, 2);
    t.take_events();
    t.ime_preedit("にほ", Some((6, 6)));
    assert_eq!(t.value_of(2).as_deref(), Some(""), "a composition isn't the value yet");
    assert!(t.take_events().is_empty());
    let mut cb = MemoryClipboard::default();
    assert!(t.key(k::BACKSPACE, None, 0, &mut cb), "the IME has the keys");
    assert!(t.ime_area().is_some());
    t.ime_preedit("", None);
    t.insert_text("日本");
    assert_eq!(t.value_of(2).as_deref(), Some("日本"));
    assert_eq!(changes(&t.take_events()), vec![(1, "日本".into())]);
}

#[test]
fn releasing_the_focused_input_clears_the_focus() {
    let mut t = tree();
    click(&mut t, 2);
    let mut o = Ops::new();
    o.release(2);
    t.apply(&o.take()).unwrap();
    assert_eq!(t.focused(), None);
    t.check().unwrap();
    let mut cb = MemoryClipboard::default();
    assert!(!t.key('a' as u32, Some("a"), 0, &mut cb));
}

#[test]
fn inputs_take_no_children_and_value_ops_need_an_input() {
    let mut t = tree();
    let mut o = Ops::new();
    o.create(9).insert(2, 9, 0).value(4, 0, "x").focus(4);
    let r = t.apply(&o.take()).unwrap();
    assert_eq!(r.errors.len(), 3, "{:?}", r.errors);
    t.check().unwrap();
}

#[test]
fn a_focus_scope_keeps_tab_inside_and_gives_the_focus_back() {
    // dunkbing/mantou#6: a search field behind a dialog with three inputs.
    use mantou_tree::protocol::focus_scope_flag as fs;
    let mut t = tree();
    let mut cb = MemoryClipboard::default();
    click(&mut t, 2); // the search field has the focus
    let mut o = Ops::new();
    o.create(10)
        .style(10, Prop::Position, Value::Enum(1))
        .style(10, Prop::Left, px(0.0))
        .style(10, Prop::Top, px(0.0))
        .style(10, Prop::Right, px(0.0))
        .style(10, Prop::Bottom, px(0.0))
        .focus_scope(10, fs::TRAP | fs::RESTORE);
    for id in [11, 12, 13] {
        o.create_input(id).style(id, Prop::Height, px(24.0)).insert(10, id, 0);
    }
    o.insert(1, 10, 0).focus(11); // opens with its first field focused (autoFocus)
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.focused(), Some(11));
    let mut seen = vec![];
    for _ in 0..4 {
        t.key(k::TAB, None, 0, &mut cb);
        seen.push(t.focused().unwrap());
    }
    assert_eq!(seen, vec![12, 13, 11, 12], "never the search field behind it");
    t.key(k::TAB, None, m::SHIFT, &mut cb);
    assert_eq!(t.focused(), Some(11));
    // Closing the dialog (its nodes released) gives the focus back to the search field.
    o.remove(1, 10).release(11).release(12).release(13).release(10);
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.focused(), Some(2));
    t.take_events();
    // Tab goes through every input again.
    t.key(k::TAB, None, 0, &mut cb);
    assert_eq!(t.focused(), Some(3));
}

#[test]
fn a_closing_scope_leaves_the_focus_alone_if_the_user_moved_it() {
    use mantou_tree::protocol::focus_scope_flag as fs;
    let mut t = tree();
    click(&mut t, 2);
    let mut o = Ops::new();
    o.create(10).focus_scope(10, fs::TRAP | fs::RESTORE).create_input(11).insert(10, 11, 0).insert(1, 10, 0).focus(11);
    t.apply(&o.take()).unwrap();
    t.layout();
    click(&mut t, 3); // the user picks the multiline input outside the dialog
    o.focus_scope(10, 0); // the dialog stops being a scope
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.focused(), Some(3));
    // Hidden instead of released also counts as leaving the screen.
    o.focus_scope(10, fs::TRAP | fs::RESTORE).focus(11);
    t.apply(&o.take()).unwrap();
    t.layout();
    o.style(10, Prop::Display, Value::Enum(1));
    t.apply(&o.take()).unwrap();
    t.layout();
    assert_eq!(t.focused(), Some(3), "focus was in the scope's input, now hidden: back to where it was before");
}

/// A multiline input of auto width in a column is stretched to the column's width, and its height is its text's
/// wrapped there (not at the default input width): the same as an input given that width.
#[test]
fn a_stretched_multiline_input_is_as_tall_as_its_text_at_its_width() {
    let text = "word ".repeat(120);
    let build = |width: Option<f32>, align: Option<u32>| {
        let mut o = Ops::new();
        o.create(1).style(1, Prop::Width, px(500.0)).create_input(2).input_options(2, input_flag::MULTILINE, 0).value(2, 0, &text);
        if let Some(w) = width {
            o.style(2, Prop::Width, px(w));
        }
        if let Some(a) = align {
            o.style(1, Prop::AlignItems, Value::Enum(a));
        }
        o.insert(1, 2, 0).set_root(1);
        let mut t = Tree::new();
        t.set_viewport(500, 2000, 1.0);
        t.apply(&o.bytes()).unwrap();
        t.layout();
        t.rect(2).unwrap()
    };
    let stretched = build(None, None);
    let given = build(Some(500.0), None);
    assert_eq!(stretched[2] - stretched[0], 500.0, "stretched across the column");
    assert_eq!(stretched, given, "as tall as an input given that width");
    // Not stretched (alignItems: start): the default width, and its text's height there, so taller.
    let start = build(None, Some(mantou_tree::protocol::align_items::START));
    assert!(start[2] - start[0] < 500.0);
    assert!(start[3] - start[1] > given[3] - given[1], "{start:?} vs {given:?}");
}
