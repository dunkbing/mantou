//! One UI instance: a shadow tree, its latest scene, its event queue and
//! counters. The window is one instance; headless test instances are others
//! (design §12.2). Nothing here touches winit or a GPU surface.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use mantou_tree::protocol::event as ev;
use mantou_tree::{Scene, Tree};

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
pub const STAT_COUNT: usize = 12;

#[derive(Default)]
struct Pointer {
    /// Logical px.
    position: (f32, f32),
    /// The press target under the pointer when the primary button went down.
    pressed_on: Option<u32>,
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
        }
    }

    /// Queues an event for JS and wakes the Worker, at most once until it takes them.
    pub fn push_event(&self, rec: [u32; 4]) {
        lock(&self.events).extend_from_slice(&rec);
        bump(&self.stats.events);
        self.wake_js();
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

    /// Moves whole event records into `out` and returns the bytes written.
    pub fn take_events(&self, out: &mut [u8]) -> usize {
        // Clear before taking: an event pushed after this point either lands in
        // this take or wakes the Worker again, so none is ever stranded.
        self.wake_pending.store(false, Ordering::Release);
        let mut q = lock(&self.events);
        let n_words = q.len().min((out.len() / 16) * 4);
        for (chunk, word) in out[..n_words * 4].chunks_exact_mut(4).zip(q.drain(..n_words)) {
            chunk.copy_from_slice(&word.to_le_bytes());
        }
        n_words * 4
    }

    /// Lays out if needed and publishes a new scene. Call with the tree locked.
    fn publish(&self, tree: &mut Tree) -> bool {
        let ran = tree.layout();
        *lock(&self.scene) = Arc::new(tree.scene());
        ran
    }

    /// Applies a batch, lays out and publishes the scene. 0, or -1 for a malformed batch.
    pub fn commit(&self, bytes: &[u8]) -> i32 {
        let mut tree = lock(&self.tree);
        match tree.apply(bytes) {
            Ok(report) => {
                for e in &report.errors {
                    eprintln!("mantou-core: op skipped: {e}");
                }
                self.stats.op_errors.fetch_add(report.errors.len() as u64, Ordering::Relaxed);
            }
            Err(e) => {
                eprintln!("mantou-core: batch rejected: {e}");
                return -1;
            }
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

    /// Pointer input in logical px. kind: 0 = primary down, 1 = primary up, 2 = move.
    /// A press is a down and an up on the same press target.
    pub fn pointer(&self, kind: u32, x: f32, y: f32) {
        let mut p = lock(&self.pointer);
        p.position = (x, y);
        match kind {
            0 => {
                p.pressed_on = lock(&self.tree).press_target(x, y);
                drop(p);
                self.push_event([ev::POINTER_DOWN, 0, x.to_bits(), y.to_bits()]);
            }
            1 => {
                let target = lock(&self.tree).press_target(x, y);
                let pressed = p.pressed_on.take();
                drop(p);
                self.push_event([ev::POINTER_UP, 0, x.to_bits(), y.to_bits()]);
                if let Some(t) = target.filter(|t| pressed == Some(*t)) {
                    bump(&self.stats.presses);
                    self.push_event([ev::PRESS, t, x.to_bits(), y.to_bits()]);
                }
            }
            _ => {
                drop(p);
                self.push_event([ev::POINTER_MOVE, 0, x.to_bits(), y.to_bits()]);
            }
        }
    }

    pub fn pointer_position(&self) -> (f32, f32) {
        lock(&self.pointer).position
    }

    /// See `mt_stats` for the order.
    pub fn stats_array(&self) -> [u64; STAT_COUNT] {
        let st = &self.stats;
        let (layouts, ops, nodes) = {
            let t = lock(&self.tree);
            (t.stats().layouts, t.stats().ops, t.node_count() as u64)
        };
        let quads = lock(&self.scene).quads.len() as u64;
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
        ]
    }
}
