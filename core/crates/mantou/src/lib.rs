//! Mantou from Rust: the same native core the TypeScript runtime drives (layout, text, rendering, input,
//! accessibility), used directly from a Rust program, with no JavaScript and no Bun.
//!
//! This is the low-level layer. You build the UI as a tree of nodes with [`Ops`] (create, style, insert,
//! text), commit a batch, and get [`Event`]s back (presses, keys, text changes, the window closing). There
//! are no components and no reactivity here: those are the TypeScript runtime's. The ops and events are the
//! wire protocol (`schema/protocol.ts`), so anything the TypeScript side can do, you can do here.
//!
//! ```no_run
//! use mantou::{Event, Ops, Value, WindowOptions, protocol::{Prop, event_mask}};
//!
//! fn main() {
//!     std::process::exit(mantou::run(WindowOptions { title: "Hello".into(), ..Default::default() }, |window| {
//!         let mut ops = Ops::new();
//!         ops.create(1).create_text(2).text(2, "Press me").insert(1, 2, 0).listen(1, event_mask::PRESS).set_root(1);
//!         window.commit(&mut ops).unwrap();
//!         loop {
//!             for event in window.wait() {
//!                 match event {
//!                     Event::Press { target: 1, .. } => {
//!                         ops.text(2, "Pressed");
//!                         window.commit(&mut ops).unwrap();
//!                     }
//!                     Event::CloseRequested => return window.quit(0),
//!                     _ => {}
//!                 }
//!             }
//!         }
//!     }));
//! }
//! ```

use std::sync::{Condvar, Mutex};

pub use mantou_tree::{Length, Ops, Value, protocol};

use protocol::{event as ev, key_modifier as km, window_flag as wf};

/// The protocol's version: ops and events change meaning only with it.
pub const PROTOCOL_VERSION: u32 = protocol::PROTOCOL_VERSION;

/// The window's options (logical px).
#[derive(Clone, Debug)]
pub struct WindowOptions {
    pub title: String,
    pub width: u32,
    pub height: u32,
    /// 0: no limit.
    pub min_width: u32,
    pub min_height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub resizable: bool,
    pub frameless: bool,
    pub always_on_top: bool,
    pub fullscreen: bool,
    pub maximized: bool,
    /// Where its outer top left goes (logical px); None lets the system place it.
    pub position: Option<(i32, i32)>,
}

impl Default for WindowOptions {
    fn default() -> Self {
        WindowOptions {
            title: "Mantou".into(),
            width: 640,
            height: 400,
            min_width: 0,
            min_height: 0,
            max_width: 0,
            max_height: 0,
            resizable: true,
            frameless: false,
            always_on_top: false,
            fullscreen: false,
            maximized: false,
            position: None,
        }
    }
}

impl WindowOptions {
    fn encode(&self) -> Vec<u8> {
        let flags = (!self.resizable as u32 * wf::NOT_RESIZABLE)
            | (self.frameless as u32 * wf::FRAMELESS)
            | (self.always_on_top as u32 * wf::ALWAYS_ON_TOP)
            | (self.fullscreen as u32 * wf::FULLSCREEN)
            | (self.maximized as u32 * wf::MAXIMIZED)
            | (self.position.is_some() as u32 * wf::HAS_POSITION);
        let (x, y) = self.position.unwrap_or((0, 0));
        let words = [self.width, self.height, self.title.len() as u32, self.min_width, self.min_height, self.max_width, self.max_height, flags, x as u32, y as u32];
        let mut out: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        out.extend_from_slice(self.title.as_bytes());
        out
    }
}

/// What the core says happened. Coordinates are logical px from the window's top left; node ids are yours.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The window opened (device px and the scale factor).
    WindowReady { width: u32, height: u32, scale: f32 },
    Resized { width: u32, height: u32, scale: f32 },
    /// The user asked to close the window: quit, or don't.
    CloseRequested,
    /// A press (down and up on the same node) where a node listening for `event_mask::PRESS` is under the
    /// pointer: `target` is the innermost node there, which may be inside the listener (give labels
    /// `pointerEvents: none`, or walk up your own tree).
    Press { target: u32, x: f32, y: f32 },
    PointerDown { button: u32, x: f32, y: f32 },
    PointerUp { button: u32, x: f32, y: f32 },
    PointerMove { x: f32, y: f32 },
    KeyDown { key: Key, repeat: bool, mods: Modifiers },
    KeyUp { key: Key, mods: Modifiers },
    PointerEnter { target: u32 },
    PointerLeave { target: u32 },
    Wheel { target: u32, dx: f32, dy: f32 },
    Layout { target: u32, x: f32, y: f32, width: f32, height: f32 },
    Scroll { target: u32, x: f32, y: f32 },
    Focus { target: u32 },
    Blur { target: u32 },
    /// Enter in a single-line Input.
    Submit { target: u32 },
    /// The user changed an Input's text (`rev` counts their edits: pass it back with `Ops::value`).
    TextChanged { target: u32, rev: u32, text: String },
    AnimationEnd { target: u32, animation: u32 },
    ImageLoad { target: u32, width: f32, height: f32 },
    ImageError { target: u32, message: String },
    /// The core recovered from a panic (its message, as JSON with the crash report's path).
    CoreError { json: String },
    /// Anything else, as its protocol code and words (see `protocol::event`).
    Other { code: u32, words: Vec<u32> },
}

/// A key: a character ('j', 'J', ' '), or a named key ("ArrowDown", "Enter", "Escape", "F5"…).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    Char(char),
    Named(&'static str),
}

impl Key {
    fn from_code(code: u32) -> Key {
        if code < 0x110000 {
            return char::from_u32(code).map_or(Key::Named("Unidentified"), Key::Char);
        }
        Key::Named(protocol::named_key::NAMES.iter().find(|(_, c)| *c == code).map_or("Unidentified", |(n, _)| n))
    }
}

/// Modifier keys held.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub meta: bool,
}

impl Modifiers {
    fn from_bits(b: u32) -> Modifiers {
        Modifiers { shift: b & km::SHIFT != 0, ctrl: b & km::CONTROL != 0, alt: b & km::ALT != 0, meta: b & km::META != 0 }
    }
}

/// Decodes event records (`mt_take_events`' format: a head word, `code | extra << 16`, three words, then
/// the extra words) into `out`.
fn decode(words: &[u32], out: &mut Vec<Event>) {
    let f = |w: u32| f32::from_bits(w);
    let mut i = 0;
    while i + 4 <= words.len() {
        let head = words[i];
        let (code, extra) = (head & 0xffff, (head >> 16) as usize);
        let end = (i + 4 + extra).min(words.len());
        let w = &words[i..end];
        let a = |k: usize| w.get(k).copied().unwrap_or(0);
        let text = |len: u32| {
            let bytes: Vec<u8> = w[4.min(w.len())..].iter().flat_map(|x| x.to_le_bytes()).take(len as usize).collect();
            String::from_utf8_lossy(&bytes).into_owned()
        };
        out.push(match code {
            ev::WINDOW_READY => Event::WindowReady { width: a(1), height: a(2), scale: f(a(3)) },
            ev::RESIZED => Event::Resized { width: a(1), height: a(2), scale: f(a(3)) },
            ev::CLOSE_REQUESTED => Event::CloseRequested,
            ev::PRESS => Event::Press { target: a(1), x: f(a(2)), y: f(a(3)) },
            ev::POINTER_DOWN => Event::PointerDown { button: a(1), x: f(a(2)), y: f(a(3)) },
            ev::POINTER_UP => Event::PointerUp { button: a(1), x: f(a(2)), y: f(a(3)) },
            ev::POINTER_MOVE => Event::PointerMove { x: f(a(2)), y: f(a(3)) },
            ev::KEY_DOWN => Event::KeyDown { key: Key::from_code(a(1)), repeat: a(2) != 0, mods: Modifiers::from_bits(a(3)) },
            ev::KEY_UP => Event::KeyUp { key: Key::from_code(a(1)), mods: Modifiers::from_bits(a(3)) },
            ev::POINTER_ENTER => Event::PointerEnter { target: a(1) },
            ev::POINTER_LEAVE => Event::PointerLeave { target: a(1) },
            ev::WHEEL => Event::Wheel { target: a(1), dx: f(a(2)), dy: f(a(3)) },
            ev::LAYOUT => Event::Layout { target: a(1), x: f(a(2)), y: f(a(3)), width: f(a(4)), height: f(a(5)) },
            ev::SCROLL => Event::Scroll { target: a(1), x: f(a(2)), y: f(a(3)) },
            ev::FOCUS => Event::Focus { target: a(1) },
            ev::BLUR => Event::Blur { target: a(1) },
            ev::SUBMIT => Event::Submit { target: a(1) },
            ev::TEXT_CHANGED => Event::TextChanged { target: a(1), rev: a(2), text: text(a(3)) },
            ev::ANIMATION_END => Event::AnimationEnd { target: a(1), animation: a(2) },
            ev::IMAGE_LOAD => Event::ImageLoad { target: a(1), width: f(a(2)), height: f(a(3)) },
            ev::IMAGE_ERROR => Event::ImageError { target: a(1), message: text(a(3)) },
            ev::CORE_ERROR => Event::CoreError { json: text(a(3)) },
            _ => Event::Other { code, words: w[1..].to_vec() },
        });
        i = end;
    }
}

/// Takes every queued event of instance `inst`.
fn take(inst: u32) -> Vec<Event> {
    let mut out = Vec::new();
    let mut buf = vec![0u32; 16 * 1024];
    loop {
        // SAFETY: the buffer is valid for its length in bytes.
        let n = unsafe { mantou_ffi::mt_take_events(inst, buf.as_mut_ptr().cast(), (buf.len() * 4) as u32) };
        if n == 0 {
            return out;
        }
        if n >= 0x8000_0000 {
            let need = ((n - 0x8000_0000) as usize).div_ceil(4);
            buf.resize(need.max(buf.len() * 2), 0);
            continue;
        }
        decode(&buf[..n as usize / 4], &mut out);
    }
}

/// A batch the core rejected as malformed (nothing in it was applied).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitError(pub i32);

impl std::fmt::Display for CommitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the core rejected a batch ({})", self.0)
    }
}

impl std::error::Error for CommitError {}

fn commit(inst: u32, ops: &mut Ops) -> Result<(), CommitError> {
    let bytes = ops.take();
    if bytes.is_empty() {
        return Ok(());
    }
    // SAFETY: the bytes are valid for their length during the call.
    match unsafe { mantou_ffi::mt_commit(inst, bytes.as_ptr(), bytes.len() as u32) } {
        0 => Ok(()),
        r => Err(CommitError(r)),
    }
}

// The core calls this from its thread when events are waiting: it wakes `Window::wait`.
static WOKEN: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

extern "C" fn wake() {
    *WOKEN.0.lock().unwrap_or_else(|e| e.into_inner()) = true;
    WOKEN.1.notify_all();
}

/// The app's window, from the app's thread (it's `Send` and `Copy`).
#[derive(Clone, Copy, Debug)]
pub struct Window {
    handle: u32,
}

impl Window {
    /// Applies a batch of ops (and empties `ops` for the next): one per change, like the TypeScript
    /// runtime's one commit per turn. The core lays out and draws on its own thread.
    pub fn commit(&self, ops: &mut Ops) -> Result<(), CommitError> {
        commit(self.handle, ops)
    }

    /// Blocks until the core has events, and returns them (in order).
    pub fn wait(&self) -> Vec<Event> {
        loop {
            let events = take(self.handle);
            if !events.is_empty() {
                return events;
            }
            let mut woken = WOKEN.0.lock().unwrap_or_else(|e| e.into_inner());
            while !*woken {
                woken = WOKEN.1.wait(woken).unwrap_or_else(|e| e.into_inner());
            }
            *woken = false;
        }
    }

    /// The events waiting now, without blocking.
    pub fn events(&self) -> Vec<Event> {
        take(self.handle)
    }

    /// Ends the app: `run` returns `code` (the window closes).
    pub fn quit(&self, code: i32) {
        mantou_ffi::mt_quit(code);
    }
}

/// Opens the window and runs its event loop on this thread, which must be the process's main thread (macOS
/// requires it), while `app` runs on a thread of its own with the [`Window`]. Returns the code passed to
/// [`Window::quit`].
pub fn run(options: WindowOptions, app: impl FnOnce(Window) + Send + 'static) -> i32 {
    let window = Window { handle: mantou_ffi::mt_app() };
    mantou_ffi::mt_set_wake(window.handle, Some(wake));
    std::thread::Builder::new().name("mantou-app".into()).spawn(move || app(window)).expect("start the app thread");
    let cfg = options.encode();
    // SAFETY: the config is valid for its length during the call.
    unsafe { mantou_ffi::mt_run(cfg.as_ptr(), cfg.len() as u32) }
}

/// A headless instance: the real tree, layout, text and renderer with no window, for tests. Everything runs
/// on the caller's thread, and time moves only with [`Headless::step`], so tests are deterministic.
pub struct Headless {
    handle: u32,
}

impl Headless {
    /// A viewport of `width` × `height` logical px at `scale` device px per px.
    pub fn new(width: u32, height: u32, scale: f32) -> Headless {
        let handle = mantou_ffi::mt_headless_new((width as f32 * scale).round() as u32, (height as f32 * scale).round() as u32, scale);
        assert!(handle != 0, "mantou: could not make a headless instance");
        Headless { handle }
    }

    pub fn commit(&self, ops: &mut Ops) -> Result<(), CommitError> {
        commit(self.handle, ops)
    }

    /// Advances the clock by `ms` (animations), lays out, and returns the events waiting.
    pub fn step(&self, ms: f64) -> Vec<Event> {
        mantou_ffi::mt_test_step(self.handle, ms);
        take(self.handle)
    }

    /// A press (down and up) at logical (x, y); returns the events it caused.
    pub fn press(&self, x: f32, y: f32) -> Vec<Event> {
        mantou_ffi::mt_test_input(self.handle, 0, x, y);
        mantou_ffi::mt_test_input(self.handle, 1, x, y);
        self.step(0.0)
    }

    /// A key pressed and released: a character, or a named key's code (`protocol::named_key`).
    pub fn key(&self, key: u32, mods: Modifiers) -> Vec<Event> {
        let bits = (mods.shift as u32 * km::SHIFT) | (mods.ctrl as u32 * km::CONTROL) | (mods.alt as u32 * km::ALT) | (mods.meta as u32 * km::META);
        mantou_ffi::mt_test_key(self.handle, key, 1, bits);
        mantou_ffi::mt_test_key(self.handle, key, 0, bits);
        self.step(0.0)
    }

    /// Node `id`'s box as drawn, [x0, y0, x1, y1] in logical px, or None when it isn't placed.
    pub fn rect(&self, id: u32) -> Option<[f32; 4]> {
        mantou_ffi::mt_test_step(self.handle, 0.0);
        let mut r = [0f32; 4];
        // SAFETY: r is valid for four f32 writes.
        (unsafe { mantou_ffi::mt_test_node_rect(self.handle, id, r.as_mut_ptr()) } == 0).then_some(r)
    }

    /// The scene as text: `size`, `clear`, then a `quad x0 y0 x1 y1 #rrggbbaa` per rectangle drawn.
    pub fn scene(&self) -> String {
        mantou_ffi::mt_test_step(self.handle, 0.0);
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            // SAFETY: the buffer is valid for its length.
            let n = unsafe { mantou_ffi::mt_test_scene(self.handle, buf.as_mut_ptr(), buf.len() as u32) } as usize;
            if n <= buf.len() {
                return String::from_utf8_lossy(&buf[..n]).into_owned();
            }
            buf.resize(n, 0);
        }
    }
}

impl Drop for Headless {
    fn drop(&mut self) {
        mantou_ffi::mt_headless_free(self.handle);
    }
}
