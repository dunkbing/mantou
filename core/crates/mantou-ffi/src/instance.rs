//! One UI instance: a shadow tree, its latest scene, its event queue and
//! counters. The window is one instance; headless test instances are others
//! (design §12.2). Nothing here touches winit or a GPU surface.

use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use mantou_tree::protocol::{event as ev, key_modifier};
use mantou_tree::{Clipboard, TreeEvent, MemoryClipboard, Scene, Tree};

/// A poisoned lock only means another entry point panicked; the data is still usable.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn bump(c: &AtomicU64) {
    c.fetch_add(1, Ordering::Relaxed);
}

#[derive(Default)]
pub struct Stats {
    pub frames: AtomicU64,
    pub commits: AtomicU64,
    pub wakes: AtomicU64,
    pub events: AtomicU64,
    pub resizes: AtomicU64,
    pub redraw_requests: AtomicU64,
    pub op_errors: AtomicU64,
    pub presses: AtomicU64,
}

/// Counter order of `mt_stats`.
pub const STAT_COUNT: usize = 15;

/// Presses this close in time (ms) and space (logical px) count as a double (triple…) click.
const MULTI_CLICK_MS: f64 = 500.0;
const MULTI_CLICK_PX: f32 = 4.0;

#[derive(Default)]
struct Pointer {
    /// Logical px.
    position: (f32, f32),
    /// The press target under the pointer when the primary button went down.
    pressed_on: Option<u32>,
    primary_down: bool,
    /// The last primary press (time ms, x, y) and how many came in a row.
    last_down: Option<(f64, f32, f32)>,
    clicks: u32,
}

/// The window's clipboard: the system's, else one in memory.
pub struct SystemClipboard {
    system: Option<arboard::Clipboard>,
    fallback: MemoryClipboard,
}

impl SystemClipboard {
    pub fn new() -> SystemClipboard {
        let system = arboard::Clipboard::new().inspect_err(|e| log!("no system clipboard ({e}); using one in memory")).ok();
        SystemClipboard { system, fallback: MemoryClipboard::default() }
    }
}

impl Clipboard for SystemClipboard {
    fn get(&mut self) -> Option<String> {
        match self.system.as_mut() {
            Some(c) => c.get_text().ok().filter(|t| !t.is_empty()),
            None => self.fallback.get(),
        }
    }
    fn set(&mut self, text: &str) {
        match self.system.as_mut() {
            Some(c) => {
                if let Err(e) = c.set_text(text) {
                    log!("could not copy: {e}");
                }
            }
            None => self.fallback.set(text),
        }
    }
}

pub struct Instance {
    /// Taken by commits (Worker thread) and, for the window, resizes (main thread).
    pub tree: Mutex<Tree>,
    /// The latest scene; drawing never holds the tree lock.
    pub scene: Mutex<Arc<Scene>>,
    pub stats: Stats,
    /// Headless instances have no window: input and stepping happen on the caller's thread.
    pub headless: bool,
    /// Manual clock of a headless instance, in ms (advanced by `mt_test_step`).
    pub clock_ms: Mutex<f64>,
    events: Mutex<Vec<u32>>,
    wake_pending: AtomicBool,
    /// `extern "C" fn()` of the threadsafe JSCallback, 0 when none.
    wake: AtomicUsize,
    pointer: Mutex<Pointer>,
    /// Modifier keys held (key_modifier bits), for shift-clicks.
    pub modifiers: AtomicU32,
    /// Keys whose key-down an input used: their key-up isn't sent either.
    swallowed: Mutex<HashSet<u32>>,
    /// The window's is created on the main thread, on first use (macOS wants that).
    clipboard: Mutex<Option<Box<dyn Clipboard + Send>>>,
    started: Instant,
    /// Headless instances: the answers queued for platform services, one per request (None cancels).
    answers: Mutex<VecDeque<Option<String>>>,
    /// The last service request (JSON), for tests to assert on.
    pub last_service: Mutex<String>,
}

impl Instance {
    pub fn new(headless: bool) -> Instance {
        Instance {
            tree: Mutex::new(Tree::new()),
            scene: Mutex::new(Arc::new(Scene { clear: [0.08, 0.08, 0.1, 1.0], ..Scene::default() })),
            stats: Stats::default(),
            headless,
            clock_ms: Mutex::new(0.0),
            events: Mutex::new(Vec::new()),
            wake_pending: AtomicBool::new(false),
            wake: AtomicUsize::new(0),
            pointer: Mutex::new(Pointer::default()),
            modifiers: AtomicU32::new(0),
            swallowed: Mutex::new(HashSet::new()),
            clipboard: Mutex::new(None),
            started: Instant::now(),
            answers: Mutex::new(VecDeque::new()),
            last_service: Mutex::new(String::new()),
        }
    }

    /// Runs `f` with the clipboard: the system's for the window, a private one for headless instances.
    pub fn with_clipboard<R>(&self, f: impl FnOnce(&mut dyn Clipboard) -> R) -> R {
        let mut slot = lock(&self.clipboard);
        let cb = slot.get_or_insert_with(|| if self.headless { Box::new(MemoryClipboard::default()) } else { Box::new(SystemClipboard::new()) });
        f(cb.as_mut())
    }

    /// Milliseconds on the instance's clock (the manual one for headless instances).
    fn now_ms(&self) -> f64 {
        if self.headless { *lock(&self.clock_ms) } else { self.started.elapsed().as_secs_f64() * 1000.0 }
    }

    /// Queues an event for JS and wakes the Worker, at most once until it takes them.
    pub fn push_event(&self, rec: [u32; 4]) {
        self.push_record(&rec, &[]);
    }

    /// Queues an event with extra words after its four (protocol: `head >> 16` of them).
    fn push_record(&self, rec: &[u32; 4], extra: &[u32]) {
        {
            let mut q = lock(&self.events);
            q.push(rec[0] | (extra.len() as u32) << 16);
            q.extend_from_slice(&rec[1..]);
            q.extend_from_slice(extra);
        }
        bump(&self.stats.events);
        self.wake_js();
    }

    /// Queues the answer to a service request (`None`: the user cancelled).
    pub fn push_service_result(&self, req: u32, answer: Option<&str>) {
        let words = mantou_tree::encode::string_words(answer.unwrap_or(""));
        self.push_record(&[ev::SERVICE_RESULT, req, answer.is_none() as u32, words[0]], &words[1..]);
    }

    /// Queues a chosen app-menu item.
    pub fn push_menu(&self, id: &str) {
        let words = mantou_tree::encode::string_words(id);
        self.push_record(&[ev::MENU, 0, 0, words[0]], &words[1..]);
    }

    /// Queues an answer for the next service request of a headless instance.
    pub fn queue_answer(&self, answer: Option<String>) {
        lock(&self.answers).push_back(answer);
    }

    /// Takes a headless instance's next queued answer: `None` when none is queued, `Some(None)` for a cancel.
    pub fn next_answer(&self) -> Option<Option<String>> {
        lock(&self.answers).pop_front()
    }

    /// Queues the tree's events (inputs' focus and text, layout changes) for JS.
    fn flush_events(&self, tree: &mut Tree) {
        for e in tree.take_events() {
            match e {
                TreeEvent::Focus(id) => self.push_event([ev::FOCUS, id, 0, 0]),
                TreeEvent::Blur(id) => self.push_event([ev::BLUR, id, 0, 0]),
                TreeEvent::Submit(id) => self.push_event([ev::SUBMIT, id, 0, 0]),
                TreeEvent::Changed { id, rev, text } => {
                    let words = mantou_tree::encode::string_words(&text);
                    self.push_record(&[ev::TEXT_CHANGED, id, rev, words[0]], &words[1..]);
                }
                TreeEvent::ImageLoad { id, size: [w, h] } => self.push_event([ev::IMAGE_LOAD, id, w.to_bits(), h.to_bits()]),
                TreeEvent::ImageError { id, message } => {
                    let words = mantou_tree::encode::string_words(&message);
                    self.push_record(&[ev::IMAGE_ERROR, id, 0, words[0]], &words[1..]);
                }
                TreeEvent::Scroll { id, offset: [x, y] } => self.push_event([ev::SCROLL, id, x.to_bits(), y.to_bits()]),
                TreeEvent::Layout { id, rect: [x, y, w, h] } => {
                    self.push_record(&[ev::LAYOUT, id, x.to_bits(), y.to_bits()], &[w.to_bits(), h.to_bits()]);
                }
            }
        }
    }

    pub fn events_pending(&self) -> bool {
        !lock(&self.events).is_empty()
    }

    fn wake_js(&self) {
        if self.wake_pending.swap(true, Ordering::AcqRel) {
            return; // a wake-up is already on its way; the Worker takes everything at once
        }
        let f = self.wake.load(Ordering::Acquire);
        if f == 0 {
            // Nobody to wake (yet, or ever for a headless instance): the caller takes events itself.
            self.wake_pending.store(false, Ordering::Release);
            return;
        }
        bump(&self.stats.wakes);
        // SAFETY: `f` was registered by mt_set_wake as a threadsafe JSCallback
        // pointer with the signature `void (*)(void)`. Bun queues the call to the
        // Worker's thread and returns.
        let f: extern "C" fn() = unsafe { std::mem::transmute::<usize, extern "C" fn()>(f) };
        f();
    }

    pub fn set_wake(&self, f: Option<extern "C" fn()>) {
        self.wake.store(f.map_or(0, |f| f as usize), Ordering::Release);
        if f.is_some() && self.events_pending() {
            self.wake_js();
        }
    }

    /// Moves whole event records into `out` and returns the bytes written:
    /// 0 when none are queued, or `0x8000_0000 | size` when the next record
    /// alone doesn't fit (the caller retries with a buffer that size).
    pub fn take_events(&self, out: &mut [u8]) -> u32 {
        // Clear before taking: an event pushed after this point either lands in
        // this take or wakes the Worker again, so none is ever stranded.
        self.wake_pending.store(false, Ordering::Release);
        let mut q = lock(&self.events);
        let cap = out.len() / 4;
        let mut n = 0;
        while n < q.len() {
            let len = 4 + (q[n] >> 16) as usize;
            if n + len > cap {
                if n == 0 {
                    self.wake_pending.store(true, Ordering::Release); // still pending: the caller retries
                    return 0x8000_0000 | (len * 4) as u32;
                }
                break;
            }
            n += len;
        }
        for (chunk, word) in out[..n * 4].chunks_exact_mut(4).zip(q.drain(..n)) {
            chunk.copy_from_slice(&word.to_le_bytes());
        }
        if !q.is_empty() {
            self.wake_pending.store(true, Ordering::Release); // the caller takes again
        }
        (n * 4) as u32
    }

    /// Lays out if needed, publishes a new scene, and queues the tree's
    /// events (layout changes among them). Call with the tree locked.
    fn publish(&self, tree: &mut Tree) -> bool {
        let ran = tree.layout();
        // An unchanged tree would draw the same scene: keep the one published.
        if ran || tree.scene_stale() {
            *lock(&self.scene) = Arc::new(tree.scene());
        }
        self.flush_events(tree);
        ran
    }

    /// Applies a batch, lays out and publishes the scene. 0, or -1 for a malformed batch.
    pub fn commit(&self, bytes: &[u8]) -> i32 {
        let mut tree = lock(&self.tree);
        match tree.apply(bytes) {
            Ok(report) => {
                for e in &report.errors {
                    log!("op skipped: {e}");
                }
                self.stats.op_errors.fetch_add(report.errors.len() as u64, Ordering::Relaxed);
            }
            Err(e) => {
                log!("batch rejected: {e}");
                return -1;
            }
        }
        // A headless instance has no window: a size the app asks for resizes its viewport.
        if self.headless
            && let Some([w, h]) = tree.take_window_size()
        {
            let scale = tree.scale();
            let (wp, hp) = ((w * scale).round() as u32, (h * scale).round() as u32);
            tree.set_viewport(wp.max(1), hp.max(1), scale);
            bump(&self.stats.resizes);
            self.push_event([ev::RESIZED, wp, hp, scale.to_bits()]);
        }
        self.publish(&mut tree);
        bump(&self.stats.commits);
        0
    }

    /// Sets the viewport and lays out at once, without JS.
    pub fn relayout(&self, width_px: u32, height_px: u32, scale: f32) {
        let mut tree = lock(&self.tree);
        tree.set_viewport(width_px, height_px, scale);
        self.publish(&mut tree);
    }

    /// Lays out if something changed since; returns whether it ran.
    pub fn layout_if_needed(&self) -> bool {
        let mut tree = lock(&self.tree);
        self.publish(&mut tree)
    }

    /// Runs an input change on the tree; if it changed anything, queues its
    /// events and publishes a new scene. Returns whether it did (the window then redraws).
    fn edit(&self, f: impl FnOnce(&mut Tree) -> bool) -> bool {
        let mut tree = lock(&self.tree);
        let changed = f(&mut tree);
        if changed {
            self.publish(&mut tree);
        } else {
            self.flush_events(&mut tree);
        }
        changed
    }

    /// Pointer input in logical px. kind: 0 = primary down, 1 = primary up, 2 = move.
    /// A press is a down and an up on the same press target. Returns whether
    /// the scene changed (an input got the focus or a selection).
    pub fn pointer(&self, kind: u32, x: f32, y: f32) -> bool {
        let mut p = lock(&self.pointer);
        p.position = (x, y);
        match kind {
            0 => {
                let now = self.now_ms();
                let near = |(t, px, py): (f64, f32, f32)| now - t <= MULTI_CLICK_MS && (x - px).abs() <= MULTI_CLICK_PX && (y - py).abs() <= MULTI_CLICK_PX;
                p.clicks = if p.last_down.is_some_and(near) { p.clicks + 1 } else { 1 };
                p.last_down = Some((now, x, y));
                p.primary_down = true;
                let clicks = p.clicks;
                p.pressed_on = lock(&self.tree).press_target(x, y);
                drop(p);
                self.push_event([ev::POINTER_DOWN, 0, x.to_bits(), y.to_bits()]);
                let shift = self.modifiers.load(Ordering::Relaxed) & key_modifier::SHIFT != 0;
                self.edit(|t| t.pointer_down(x, y, clicks, shift))
            }
            1 => {
                let target = lock(&self.tree).press_target(x, y);
                let pressed = p.pressed_on.take();
                p.primary_down = false;
                drop(p);
                lock(&self.tree).pointer_up();
                self.push_event([ev::POINTER_UP, 0, x.to_bits(), y.to_bits()]);
                if let Some(t) = target.filter(|t| pressed == Some(*t)) {
                    bump(&self.stats.presses);
                    self.push_event([ev::PRESS, t, x.to_bits(), y.to_bits()]);
                }
                false
            }
            _ => {
                let dragging = p.primary_down;
                drop(p);
                self.push_event([ev::POINTER_MOVE, 0, x.to_bits(), y.to_bits()]);
                dragging && self.edit(|t| t.pointer_drag(x, y))
            }
        }
    }

    /// A wheel or trackpad scroll at (x, y) logical px; positive dy scrolls content up.
    /// Scrolls the scroll view under the point here, without JS (design
    /// §9.4), and still tells JS about the wheel. Returns whether the scene changed.
    pub fn wheel(&self, x: f32, y: f32, dx: f32, dy: f32) -> bool {
        let target = lock(&self.tree).hit(x, y).unwrap_or(0);
        let scrolled = self.edit(|t| t.wheel(x, y, dx, dy));
        self.push_event([ev::WHEEL, target, dx.to_bits(), dy.to_bits()]);
        scrolled
    }

    /// A key event: `key` is a Unicode scalar or a named key code, `text` what
    /// it types. The focused input sees key-downs first; the keys it uses
    /// don't reach JS. Returns whether the scene changed.
    pub fn key(&self, key: u32, text: Option<&str>, down: bool, repeat: bool, modifiers: u32) -> bool {
        self.modifiers.store(modifiers, Ordering::Relaxed);
        if !down {
            if !lock(&self.swallowed).remove(&key) {
                self.push_event([ev::KEY_UP, key, 0, modifiers]);
            }
            return false;
        }
        let mut used = false;
        let changed = self.edit(|t| {
            if t.focused().is_none() {
                return false;
            }
            used = self.with_clipboard(|cb| t.key(key, text, modifiers, cb));
            used
        });
        if used {
            lock(&self.swallowed).insert(key);
        } else {
            self.push_event([ev::KEY_DOWN, key, repeat as u32, modifiers]);
        }
        changed
    }

    /// Text for the focused input that isn't from a key: an IME commit, or a test typing.
    pub fn insert_text(&self, text: &str) -> bool {
        self.edit(|t| t.insert_text(text))
    }

    /// The IME's composition; empty ends it.
    pub fn ime_preedit(&self, text: &str, cursor: Option<(usize, usize)>) -> bool {
        self.edit(|t| t.ime_preedit(text, cursor))
    }

    pub fn pointer_position(&self) -> (f32, f32) {
        lock(&self.pointer).position
    }

    /// See `mt_stats` for the order.
    pub fn stats_array(&self) -> [u64; STAT_COUNT] {
        let st = &self.stats;
        let (tree_stats, nodes) = {
            let t = lock(&self.tree);
            (t.stats(), t.node_count() as u64)
        };
        let (layouts, ops) = (tree_stats.layouts, tree_stats.ops);
        let (quads, glyphs) = {
            let scene = lock(&self.scene);
            let glyphs = scene.quads.iter().filter(|q| q.is_glyph()).count() as u64;
            (scene.quads.len() as u64 - glyphs, glyphs)
        };
        let load = |c: &AtomicU64| c.load(Ordering::Relaxed);
        [
            load(&st.frames),
            load(&st.commits),
            load(&st.wakes),
            load(&st.events),
            load(&st.resizes),
            load(&st.redraw_requests),
            layouts,
            ops,
            load(&st.op_errors),
            quads,
            nodes,
            load(&st.presses),
            glyphs,
            tree_stats.scenes,
            tree_stats.text_layouts,
        ]
    }
}
