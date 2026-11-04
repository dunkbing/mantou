// The accessibility tree built from the shadow tree: roles, names, values and
// states, as a to-do list (design §10).
use accesskit::{Action, Role, Toggled};
use mantou_tree::protocol::{access_flag as flag, access_role as role, event_mask, input_flag};
use mantou_tree::tree::access::node_id;
use mantou_tree::{Ops, Tree};

/// A column: a title, an input, two rows (a pressable view around a box and a
/// text) with the first ticked, and a password input.
fn todos() -> Tree {
    let mut o = Ops::new();
    o.create(1)
        .create_text(2).text(2, "To do")
        .create_input(3).placeholder(3, "What needs doing?")
        .create(4).listen(4, event_mask::PRESS).access(4, role::CHECKBOX, flag::CHECKED, "")
        .create(5)
        .create_text(6).text(6, "Buy milk")
        .create(7).listen(7, event_mask::PRESS).access(7, role::CHECKBOX, 0, "")
        .create(8)
        .create_text(9).text(9, "Walk the dog")
        .create_input(10).input_options(10, input_flag::SECURE, 0).access(10, role::AUTO, 0, "Password")
        .insert(4, 5, 0).insert(4, 6, 0).insert(7, 8, 0).insert(7, 9, 0)
        .insert(1, 2, 0).insert(1, 3, 0).insert(1, 4, 0).insert(1, 7, 0).insert(1, 10, 0)
        .set_root(1);
    let mut t = Tree::new();
    t.set_viewport(400, 300, 1.0);
    let r = t.apply(&o.bytes()).unwrap();
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    t.layout();
    t
}

#[test]
fn the_to_do_list_reads_as_a_form_with_checkboxes() {
    let t = todos();
    assert_eq!(
        t.accessibility_dump(),
        "\
Window
  GenericContainer
    Label value=\"To do\"
    TextInput value=\"\"
    CheckBox \"Buy milk\" True
      GenericContainer
      Label value=\"Buy milk\"
    CheckBox \"Walk the dog\" False
      GenericContainer
      Label value=\"Walk the dog\"
    PasswordInput \"Password\"
"
    );
}

#[test]
fn pressable_nodes_can_be_clicked_and_inputs_focused_and_set() {
    let t = todos();
    let u = t.accessibility();
    let get = |id: u32| u.nodes.iter().find(|(n, _)| *n == node_id(id)).map(|(_, n)| n).unwrap();
    assert!(get(4).supports_action(Action::Click));
    assert!(!get(1).supports_action(Action::Click));
    assert!(get(3).supports_action(Action::Focus) && get(3).supports_action(Action::SetValue));
    assert_eq!(get(3).placeholder(), Some("What needs doing?"));
    assert_eq!(get(4).toggled(), Some(Toggled::True));
    assert_eq!(get(7).toggled(), Some(Toggled::False));
    // Bounds follow the layout, from the window's top left.
    assert!(get(4).bounds().is_some());
}

#[test]
fn a_password_field_never_exposes_its_text() {
    let mut t = todos();
    let mut o = Ops::new();
    o.value(10, 1, "hunter2");
    t.apply(&o.bytes()).unwrap();
    let u = t.accessibility();
    let pw = u.nodes.iter().find(|(n, _)| *n == node_id(10)).map(|(_, n)| n).unwrap();
    assert_eq!(pw.role(), Role::PasswordInput);
    assert_eq!(pw.value(), None);
    assert!(!t.accessibility_dump().contains("hunter2"));
}

#[test]
fn state_changes_hidden_nodes_and_the_focus_follow_the_tree() {
    let mut t = todos();
    let mut o = Ops::new();
    // Untick the first row, tick the second, hide the title, label the input and focus it.
    o.access(4, role::CHECKBOX, 0, "").access(7, role::CHECKBOX, flag::CHECKED | flag::DISABLED, "").access(2, role::AUTO, flag::HIDDEN, "")
        .access(3, role::AUTO, 0, "New to-do").value(3, 1, "Call mum").focus(3);
    t.apply(&o.bytes()).unwrap();
    let d = t.accessibility_dump();
    assert!(!d.contains("To do"), "{d}");
    assert!(d.contains("CheckBox \"Buy milk\" False"), "{d}");
    assert!(d.contains("CheckBox \"Walk the dog\" True disabled"), "{d}");
    assert!(d.contains("TextInput \"New to-do\" value=\"Call mum\""), "{d}");
    assert_eq!(t.accessibility().focus, node_id(3));
    // With nothing focused, the window has the focus.
    t.apply(&Ops::new().focus(0).bytes()).unwrap();
    assert_eq!(t.accessibility().focus, mantou_tree::tree::access::WINDOW);
}

#[test]
fn a_node_with_role_none_leaves_only_its_children() {
    let mut t = todos();
    t.apply(&Ops::new().access(4, role::NONE, 0, "").bytes()).unwrap();
    let d = t.accessibility_dump();
    assert!(!d.contains("CheckBox \"Buy milk\""), "{d}");
    assert!(d.contains("Label value=\"Buy milk\""), "{d}");
}
