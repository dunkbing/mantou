//! Platform services on the main thread (design §10): file dialogs, message
//! boxes, the app menu and context menus. A request is JSON from `mt_service`;
//! the answer goes back as a `SERVICE_RESULT` event. Dialogs are modal: the
//! window stops drawing while one is open.

use std::sync::Arc;

use serde_json::{Value, json};
use winit::window::Window;

use crate::instance::Instance;

/// Runs one request and queues its answer. Never panics outward: the caller guards.
pub fn handle(inst: &Instance, window: Option<&Arc<Window>>, menus: &mut Menus, req: u32, body: &str) {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => {
            log!("bad service request: {e}");
            return inst.push_service_result(req, None);
        }
    };
    let answer = match v["kind"].as_str() {
        Some("openFile") => open_file(&v, window),
        Some("saveFile") => save_file(&v, window),
        Some("message") => message(&v, window),
        Some("setMenu") => menus.set(inst, &v["menu"]).then(|| json!(true)),
        Some("showMenu") => menus.popup(inst, window, &v),
        other => {
            log!("unknown service {other:?}");
            None
        }
    };
    inst.push_service_result(req, answer.map(|a| a.to_string()).as_deref());
}

fn filters(v: &Value) -> Vec<(String, Vec<String>)> {
    v["filters"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|f| {
                    let exts = f["extensions"].as_array().map(|e| e.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default();
                    (f["name"].as_str().unwrap_or("Files").to_owned(), exts)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn open_file(v: &Value, window: Option<&Arc<Window>>) -> Option<Value> {
    let mut d = rfd::FileDialog::new();
    if let Some(t) = v["title"].as_str() {
        d = d.set_title(t);
    }
    if let Some(dir) = v["directory"].as_str() {
        d = d.set_directory(dir);
    }
    for (name, exts) in filters(v) {
        d = d.add_filter(name, &exts);
    }
    if let Some(w) = window {
        d = d.set_parent(&**w);
    }
    let (folder, multiple) = (v["pickFolders"].as_bool() == Some(true), v["multiple"].as_bool() == Some(true));
    let paths = match (folder, multiple) {
        (true, true) => d.pick_folders(),
        (true, false) => d.pick_folder().map(|p| vec![p]),
        (false, true) => d.pick_files(),
        (false, false) => d.pick_file().map(|p| vec![p]),
    }?;
    Some(json!(paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>()))
}

fn save_file(v: &Value, window: Option<&Arc<Window>>) -> Option<Value> {
    let mut d = rfd::FileDialog::new();
    if let Some(t) = v["title"].as_str() {
        d = d.set_title(t);
    }
    if let Some(n) = v["name"].as_str() {
        d = d.set_file_name(n);
    }
    if let Some(dir) = v["directory"].as_str() {
        d = d.set_directory(dir);
    }
    for (name, exts) in filters(v) {
        d = d.add_filter(name, &exts);
    }
    if let Some(w) = window {
        d = d.set_parent(&**w);
    }
    Some(json!(d.save_file()?.to_string_lossy()))
}

/// Answers the index of the chosen button.
fn message(v: &Value, window: Option<&Arc<Window>>) -> Option<Value> {
    let labels: Vec<String> = v["buttons"].as_array().map(|b| b.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default();
    let labels = if labels.is_empty() { vec!["OK".to_owned()] } else { labels };
    let level = match v["level"].as_str() {
        Some("warning") => rfd::MessageLevel::Warning,
        Some("error") => rfd::MessageLevel::Error,
        _ => rfd::MessageLevel::Info,
    };
    let buttons = match labels.as_slice() {
        [a] => rfd::MessageButtons::OkCustom(a.clone()),
        [a, b] => rfd::MessageButtons::OkCancelCustom(a.clone(), b.clone()),
        [a, b, c, ..] => rfd::MessageButtons::YesNoCancelCustom(a.clone(), b.clone(), c.clone()),
        [] => unreachable!(),
    };
    let mut d = rfd::MessageDialog::new()
        .set_level(level)
        .set_title(v["title"].as_str().unwrap_or(""))
        .set_description(v["message"].as_str().unwrap_or(""))
        .set_buttons(buttons);
    if let Some(w) = window {
        d = d.set_parent(&**w);
    }
    let picked = match d.show() {
        rfd::MessageDialogResult::Custom(l) => labels.iter().position(|x| *x == l),
        rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => Some(0),
        rfd::MessageDialogResult::No => Some(1),
        rfd::MessageDialogResult::Cancel => Some(labels.len().min(2).saturating_sub(1)),
    };
    picked.map(|i| json!(i))
}

/// The app menu and context menus. Menus are native on macOS; elsewhere the
/// requests are answered as cancelled for now (the app menu there is #21's next step).
#[derive(Default)]
pub struct Menus {
    #[cfg(target_os = "macos")]
    app_menu: Option<muda::Menu>,
}

#[cfg(not(target_os = "macos"))]
impl Menus {
    pub fn install_default(&mut self, _inst: &Arc<Instance>) {}
    fn set(&mut self, _inst: &Instance, _menu: &Value) -> bool {
        log!("the app menu isn't supported on this platform yet");
        false
    }
    fn popup(&mut self, _inst: &Instance, _window: Option<&Arc<Window>>, _v: &Value) -> Option<Value> {
        log!("context menus aren't supported on this platform yet");
        None
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use muda::{CheckMenuItem, ContextMenu, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, accelerator::Accelerator};
    use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};

    /// The id of the default Quit item: it asks the window to close, like its close button, so the app can veto.
    const QUIT: &str = "mantou:quit";
    /// The prefix of the Edit items' ids.
    const EDIT: &str = "mantou:edit:";

    /// An Edit item: choosing it (or its shortcut) presses the same keys in the core.
    fn edit_item(name: &str, label: &str, shortcut: &str) -> Box<dyn IsMenuItem> {
        Box::new(MenuItem::with_id(format!("{EDIT}{name}"), label, true, shortcut.parse().ok()))
    }

    /// The key (a Unicode scalar) and modifiers an Edit item stands for.
    fn edit_keys(name: &str) -> Option<(u32, u32)> {
        use mantou_tree::protocol::key_modifier::{META, SHIFT};
        Some(match name {
            "undo" => ('z' as u32, META),
            "redo" => ('z' as u32, META | SHIFT),
            "cut" => ('x' as u32, META),
            "copy" => ('c' as u32, META),
            "paste" => ('v' as u32, META),
            "selectAll" => ('a' as u32, META),
            _ => return None,
        })
    }

    fn accel(item: &Value) -> Option<Accelerator> {
        item["accelerator"].as_str()?.parse().ok()
    }

    /// Builds one item (or separator, submenu or role) from its JSON.
    fn build(item: &Value, out: &mut Vec<Box<dyn IsMenuItem>>) {
        if item["separator"].as_bool() == Some(true) {
            return out.push(Box::new(PredefinedMenuItem::separator()));
        }
        if let Some(role) = item["role"].as_str() {
            let label = item["label"].as_str();
            let p = match role {
                // Editing belongs to the core's inputs, not to AppKit's responder chain (nothing in the
                // window's view answers `copy:`, and a native item would swallow Cmd+C before the input saw it).
                "undo" => return out.push(edit_item("undo", label.unwrap_or("Undo"), "cmd+z")),
                "redo" => return out.push(edit_item("redo", label.unwrap_or("Redo"), "cmd+shift+z")),
                "cut" => return out.push(edit_item("cut", label.unwrap_or("Cut"), "cmd+x")),
                "copy" => return out.push(edit_item("copy", label.unwrap_or("Copy"), "cmd+c")),
                "paste" => return out.push(edit_item("paste", label.unwrap_or("Paste"), "cmd+v")),
                "selectAll" => return out.push(edit_item("selectAll", label.unwrap_or("Select All"), "cmd+a")),
                "hide" => PredefinedMenuItem::hide(label),
                "hideOthers" => PredefinedMenuItem::hide_others(label),
                "showAll" => PredefinedMenuItem::show_all(label),
                "minimize" => PredefinedMenuItem::minimize(label),
                // performClose:, which the window answers itself: it ends in the same `closeRequested` as the close button.
                "closeWindow" => PredefinedMenuItem::close_window(label),
                "zoom" => PredefinedMenuItem::maximize(label),
                "fullscreen" => PredefinedMenuItem::fullscreen(label),
                "about" => PredefinedMenuItem::about(label, None),
                "quit" => return out.push(Box::new(MenuItem::with_id(QUIT, label.unwrap_or("Quit"), true, "cmd+q".parse().ok()))),
                other => return log!("unknown menu role {other:?}"),
            };
            return out.push(Box::new(p));
        }
        let label = item["label"].as_str().unwrap_or("");
        let enabled = item["enabled"].as_bool() != Some(false);
        if let Some(sub) = item["items"].as_array() {
            let s = Submenu::new(label, enabled);
            fill(sub, |i| {
                let _ = s.append(i);
            });
            return out.push(Box::new(s));
        }
        let id = item["id"].as_str().unwrap_or(label);
        match item["checked"].as_bool() {
            Some(c) => out.push(Box::new(CheckMenuItem::with_id(id, label, enabled, c, accel(item)))),
            None => out.push(Box::new(MenuItem::with_id(id, label, enabled, accel(item)))),
        }
    }

    fn fill(items: &[Value], mut add: impl FnMut(&dyn IsMenuItem)) {
        let mut built = Vec::new();
        for i in items {
            build(i, &mut built);
        }
        for b in &built {
            add(b.as_ref());
        }
    }

    impl Menus {
        /// The standard App, Edit and Window menus, so Cmd+Q, Cmd+H and the Edit shortcuts work before the app sets its own.
        pub fn install_default(&mut self, inst: &Arc<Instance>) {
            let name = std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned())).unwrap_or_else(|| "Mantou".into());
            let app = json!({"label": name, "items": [
                {"role": "about", "label": format!("About {name}")}, {"separator": true},
                {"role": "hide", "label": format!("Hide {name}")}, {"role": "hideOthers"}, {"role": "showAll"}, {"separator": true},
                {"role": "quit", "label": format!("Quit {name}")}]});
            let edit = json!({"label": "Edit", "items": [
                {"role": "undo"}, {"role": "redo"}, {"separator": true},
                {"role": "cut"}, {"role": "copy"}, {"role": "paste"}, {"role": "selectAll"}]});
            let window = json!({"label": "Window", "items": [{"role": "closeWindow"}, {"role": "minimize"}, {"role": "zoom"}, {"role": "fullscreen"}]});
            self.set(inst, &json!([app, edit, window]));
        }

        pub(super) fn set(&mut self, inst: &Instance, menu: &Value) -> bool {
            let Some(top) = menu.as_array() else { return false };
            let m = Menu::new();
            fill(top, |i| {
                let _ = m.append(i);
            });
            m.init_for_nsapp();
            self.app_menu = Some(m);
            self.listen(inst);
            true
        }

        /// Chosen items arrive on the main thread, in the event loop; hand them to JS.
        fn listen(&self, _inst: &Instance) {
            MenuEvent::set_event_handler(Some(|e: MenuEvent| {
                let inst = crate::app();
                if let Some((key, mods)) = e.id.0.strip_prefix(EDIT).and_then(edit_keys) {
                    crate::send(crate::UserEvent::TestKey(key, true, mods));
                    crate::send(crate::UserEvent::TestKey(key, false, mods));
                } else if e.id.0 == QUIT {
                    inst.push_event([mantou_tree::protocol::event::CLOSE_REQUESTED, 0, 0, 0]);
                } else {
                    inst.push_menu(&e.id.0);
                }
            }));
        }

        /// Shows a context menu at the logical position and answers the chosen item's id (cancelled when none is).
        pub(super) fn popup(&mut self, _inst: &Instance, window: Option<&Arc<Window>>, v: &Value) -> Option<Value> {
            let window = window?;
            let RawWindowHandle::AppKit(h) = window.window_handle().ok()?.as_raw() else { return None };
            let menu = Menu::new();
            fill(v["items"].as_array()?, |i| {
                let _ = menu.append(i);
            });
            let (x, y) = (v["x"].as_f64().unwrap_or(0.0), v["y"].as_f64().unwrap_or(0.0));
            // Drop what an earlier menu left, so the next event is this menu's.
            let rx = MenuEvent::receiver();
            while rx.try_recv().is_ok() {}
            // SAFETY: the view belongs to the window, which is alive and on this (the main) thread.
            unsafe { menu.show_context_menu_for_nsview(h.ns_view.as_ptr(), Some(muda::dpi::LogicalPosition::new(x, y).into())) };
            // The menu is modal: the chosen item's event is queued by the time it returns.
            rx.try_recv().ok().map(|e| json!(e.id.0))
        }
    }
}
