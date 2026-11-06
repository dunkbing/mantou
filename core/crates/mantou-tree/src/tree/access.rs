//! The accessibility tree: what screen readers are told, built from the shadow
//! tree (design §10). Roles come from ACCESS or from the node's kind, names from
//! the label or the text inside, and bounds from the last layout. Platform
//! adapters (the FFI crate's window) hand the update to the OS; nothing here
//! touches a platform.

use accesskit::{Action, Node as AkNode, NodeId, Rect, Role, Toggled, TreeId, TreeInfo, TreeUpdate};

use super::Tree;
use crate::protocol::{self as p, access_flag as flag, access_role as role, event_mask};

/// The window's node; a tree node `id` is `NodeId(id + 1)`.
pub const WINDOW: NodeId = NodeId(0);

/// The node id a tree node has in the accessibility tree, and back.
pub fn node_id(id: u32) -> NodeId {
    NodeId(id as u64 + 1)
}
pub fn tree_id(id: NodeId) -> Option<u32> {
    id.0.checked_sub(1).map(|i| i as u32)
}

/// What ACCESS set on a node.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Access {
    pub role: u32,
    pub flags: u32,
    pub label: String,
}

impl Tree {
    /// The whole accessibility tree as one update (the window, its content and the focus).
    pub fn accessibility(&self) -> TreeUpdate {
        let mut nodes = Vec::new();
        let mut win = AkNode::new(Role::Window);
        if let Some(root) = self.root {
            if let Some(child) = self.access_node(root, &mut nodes) {
                win.set_children(vec![child]);
            }
        }
        let [w, h] = [self.viewport_px.0 as f64 / self.scale as f64, self.viewport_px.1 as f64 / self.scale as f64];
        win.set_bounds(Rect { x0: 0.0, y0: 0.0, x1: w, y1: h });
        nodes.push((WINDOW, win));
        let focus = self.focus.map(node_id).filter(|f| nodes.iter().any(|(id, _)| id == f)).unwrap_or(WINDOW);
        let mut info = TreeInfo::new(WINDOW);
        info.toolkit_name = Some("Mantou".into());
        TreeUpdate { nodes, tree: Some(info), tree_id: TreeId::ROOT, focus }
    }

    /// The text inside a node, its Text leaves in order, joined with spaces.
    fn text_inside(&self, id: u32, out: &mut Vec<String>) {
        let Some(n) = self.nodes.get(&id) else { return };
        if n.kind == p::node_kind::TEXT {
            let t = n.text.trim();
            if !t.is_empty() {
                out.push(t.to_owned());
            }
        }
        for &c in &n.children {
            self.text_inside(c, out);
        }
    }

    /// Adds the node and its descendants to `out`; returns its id, or None when it's hidden.
    /// A node with role None is left out, and its children join its parent.
    fn access_node(&self, id: u32, out: &mut Vec<(NodeId, AkNode)>) -> Option<NodeId> {
        let n = self.nodes.get(&id)?;
        let a = n.access.clone().unwrap_or_default();
        if n.v.hidden || a.flags & flag::HIDDEN != 0 {
            return None;
        }
        let mut kids: Vec<NodeId> = Vec::new();
        for &c in &n.children {
            kids.extend(self.access_children(c, out));
        }
        if a.role == role::NONE {
            return kids.first().copied().filter(|_| kids.len() == 1).or_else(|| {
                // Several children can't stand in for the node: keep a plain container.
                let mut g = AkNode::new(Role::GenericContainer);
                g.set_children(kids.clone());
                let nid = node_id(id);
                out.push((nid, g));
                Some(nid)
            });
        }

        let pressable = n.listen & event_mask::PRESS != 0;
        let ak_role = match a.role {
            role::BUTTON => Role::Button,
            role::CHECKBOX => Role::CheckBox,
            role::SWITCH => Role::Switch,
            role::RADIO => Role::RadioButton,
            role::LINK => Role::Link,
            role::HEADING => Role::Heading,
            role::LIST => Role::List,
            role::LIST_ITEM => Role::ListItem,
            role::DIALOG => Role::Dialog,
            role::TAB => Role::Tab,
            role::TAB_LIST => Role::TabList,
            role::MENU => Role::Menu,
            role::MENU_ITEM => Role::MenuItem,
            role::IMAGE => Role::Image,
            role::GROUP => Role::Group,
            role::STATUS => Role::Status,
            role::ALERT => Role::Alert,
            role::TREE => Role::Tree,
            role::TREE_ITEM => Role::TreeItem,
            role::RADIO_GROUP => Role::RadioGroup,
            _ => match n.kind {
                p::node_kind::TEXT => Role::Label,
                p::node_kind::IMAGE => Role::Image,
                p::node_kind::INPUT => {
                    let i = n.input.as_ref()?;
                    let ed = i.editor.borrow();
                    if ed.is_secure() {
                        Role::PasswordInput
                    } else if ed.multiline {
                        Role::MultilineTextInput
                    } else {
                        Role::TextInput
                    }
                }
                _ if pressable => Role::Button,
                _ if n.v.scrolls => Role::ScrollView,
                _ => Role::GenericContainer,
            },
        };

        let mut node = AkNode::new(ak_role);
        node.set_children(kids);
        if let Some(b) = self.boxes.iter().find(|b| b.id == id) {
            let r = b.rect;
            node.set_bounds(Rect { x0: r[0] as f64, y0: r[1] as f64, x1: r[2] as f64, y1: r[3] as f64 });
        }
        // Names: the label, else the text inside a control. Text says its own text as its value.
        match n.kind {
            p::node_kind::TEXT if ak_role == Role::Label => node.set_value(n.text.clone()),
            p::node_kind::TEXT => node.set_label(if a.label.is_empty() { n.text.clone() } else { a.label.clone() }),
            _ if !a.label.is_empty() => node.set_label(a.label.clone()),
            _ if matches!(ak_role, Role::Button | Role::CheckBox | Role::Switch | Role::RadioButton | Role::Link | Role::Heading | Role::ListItem | Role::Tab | Role::MenuItem | Role::Dialog | Role::TreeItem) => {
                let mut t = Vec::new();
                self.text_inside(id, &mut t);
                if !t.is_empty() {
                    node.set_label(t.join(" "));
                }
            }
            _ => {}
        }
        if !a.label.is_empty() && n.kind == p::node_kind::TEXT {
            node.set_label(a.label.clone());
        }
        if matches!(ak_role, Role::CheckBox | Role::Switch | Role::RadioButton | Role::MenuItem) {
            node.set_toggled(if a.flags & flag::MIXED != 0 {
                Toggled::Mixed
            } else if a.flags & flag::CHECKED != 0 {
                Toggled::True
            } else {
                Toggled::False
            });
        }
        if a.flags & flag::SELECTED != 0 {
            node.set_selected(true);
        }
        if a.flags & flag::EXPANDED != 0 {
            node.set_expanded(true);
        } else if a.flags & flag::COLLAPSED != 0 {
            node.set_expanded(false);
        }
        if a.flags & flag::DISABLED != 0 {
            node.set_disabled();
        } else {
            if pressable {
                node.add_action(Action::Click);
            }
            if n.input.is_some() {
                node.add_action(Action::Focus);
                node.add_action(Action::SetValue);
            }
        }
        if let Some(i) = n.input.as_ref() {
            let ed = i.editor.borrow();
            if !ed.is_secure() {
                node.set_value(ed.text());
            }
            if !i.placeholder.is_empty() {
                node.set_placeholder(i.placeholder.clone());
            }
            if ed.read_only {
                node.set_read_only();
            }
        }
        if n.scope != 0 && ak_role == Role::Dialog {
            node.set_modal();
        }
        let nid = node_id(id);
        out.push((nid, node));
        Some(nid)
    }

    /// The accessibility nodes a child contributes to its parent's children (none when hidden).
    fn access_children(&self, id: u32, out: &mut Vec<(NodeId, AkNode)>) -> Option<NodeId> {
        self.access_node(id, out)
    }

    /// The accessibility tree as indented text, for tests and debugging:
    /// `Role "name" value="…" [flags] (x, y, w, h)`, one node per line.
    pub fn accessibility_dump(&self) -> String {
        let u = self.accessibility();
        let by: std::collections::HashMap<NodeId, &AkNode> = u.nodes.iter().map(|(i, n)| (*i, n)).collect();
        let mut s = String::new();
        fn go(by: &std::collections::HashMap<NodeId, &AkNode>, id: NodeId, depth: usize, s: &mut String) {
            let n = by[&id];
            s.push_str(&"  ".repeat(depth));
            s.push_str(&format!("{:?}", n.role()));
            if let Some(l) = n.label() {
                s.push_str(&format!(" {l:?}"));
            }
            if let Some(v) = n.value() {
                s.push_str(&format!(" value={v:?}"));
            }
            if let Some(t) = n.toggled() {
                s.push_str(&format!(" {t:?}"));
            }
            if n.is_selected() == Some(true) {
                s.push_str(" selected");
            }
            match n.is_expanded() {
                Some(true) => s.push_str(" expanded"),
                Some(false) => s.push_str(" collapsed"),
                None => {}
            }
            if n.is_disabled() {
                s.push_str(" disabled");
            }
            s.push('\n');
            for c in n.children() {
                go(by, *c, depth + 1, s);
            }
        }
        go(&by, WINDOW, 0, &mut s);
        s
    }
}
