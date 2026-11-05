//! Native web views as children of the window (the `webview` service): wry on macOS, nothing elsewhere yet.
use crate::instance::Instance;
use serde_json::{json, Value};
use std::sync::Arc;
use winit::window::Window;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::collections::HashMap;

    /// The page tells the app when it has loaded, through the same channel as its own messages.
    const INIT: &str = "addEventListener('load',()=>window.ipc.postMessage(JSON.stringify({__mantou:1,url:location.href,title:document.title})))";

    #[derive(Default)]
    pub struct Webviews(HashMap<(u32, u32), wry::WebView>);

    fn bounds(v: &Value) -> wry::Rect {
        let f = |k: &str| v[k].as_f64().unwrap_or(0.0);
        wry::Rect {
            position: wry::dpi::LogicalPosition::new(f("x"), f("y")).into(),
            size: wry::dpi::LogicalSize::new(f("width").max(1.0), f("height").max(1.0)).into(),
        }
    }

    pub fn handle(views: &mut Webviews, handle: u32, window: Option<&Arc<Window>>, inst: &Arc<Instance>, v: &Value) -> Option<Value> {
        let id = v["id"].as_u64()? as u32;
        let key = (handle, id);
        match v["op"].as_str()? {
            "create" => {
                let window = window?;
                let i1 = inst.clone();
                let mut b = wry::WebViewBuilder::new()
                    .with_bounds(bounds(v))
                    .with_initialization_script(INIT)
                    .with_ipc_handler(move |req| {
                        let body = req.body();
                        match serde_json::from_str::<Value>(body) {
                            Ok(m) if m["__mantou"] == 1 => i1.push_webview(id, 0, &json!({ "url": m["url"], "title": m["title"] }).to_string()),
                            _ => i1.push_webview(id, 1, body),
                        }
                    });
                if let Some(html) = v["html"].as_str() {
                    b = b.with_html(html);
                } else if let Some(url) = v["url"].as_str() {
                    b = b.with_url(url);
                }
                let view = b.build_as_child(window.as_ref()).ok()?;
                views.0.insert(key, view);
                Some(json!(true))
            }
            "bounds" => views.0.get(&key)?.set_bounds(bounds(v)).ok().map(|_| json!(true)),
            "load" => {
                let view = views.0.get(&key)?;
                match (v["html"].as_str(), v["url"].as_str()) {
                    (Some(h), _) => view.load_html(h).ok()?,
                    (_, Some(u)) => view.load_url(u).ok()?,
                    _ => return None,
                }
                Some(json!(true))
            }
            "eval" => views.0.get(&key)?.evaluate_script(v["script"].as_str()?).ok().map(|_| json!(true)),
            "visible" => views.0.get(&key)?.set_visible(v["value"].as_bool().unwrap_or(true)).ok().map(|_| json!(true)),
            "focus" => views.0.get(&key)?.focus().ok().map(|_| json!(true)),
            "close" => Some(json!(views.0.remove(&key).is_some())),
            _ => None,
        }
    }

    /// Drops a window's web views (its instance is going away).
    pub fn close_all(views: &mut Webviews, handle: u32) {
        views.0.retain(|k, _| k.0 != handle);
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    #[derive(Default)]
    pub struct Webviews;

    /// No native web view on this platform: the app falls back to the image-based one.
    pub fn handle(_: &mut Webviews, _: u32, _: Option<&Arc<Window>>, _: &Arc<Instance>, _: &Value) -> Option<Value> {
        Some(json!(false))
    }

    pub fn close_all(_: &mut Webviews, _: u32) {}
}

pub use imp::{close_all, handle, Webviews};
