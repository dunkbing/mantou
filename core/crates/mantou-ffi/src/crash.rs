//! Crash reports (dunkbing/mantou#62). A panic hook writes a report for every
//! panic in the core, on any thread: the message, where, the thread, a
//! backtrace, the versions and the OS. It goes in the folder the app gives
//! (`mt_set_crash_dir`: its data folder's `crashes`), created when the first
//! report is written. A panic the core recovers from (`guard`) is also sent
//! to JS as CORE_ERROR, after it has unwound: the hook itself takes no lock
//! the panicking code might hold (only `try_lock`s).

use std::backtrace::Backtrace;
use std::path::PathBuf;
use std::sync::{Mutex, Once};
use std::time::{SystemTime, UNIX_EPOCH};

static DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
/// The last panic's message and report path, for the `guard` that catches it.
static LAST: Mutex<Option<(String, String)>> = Mutex::new(None);
static HOOK: Once = Once::new();

/// Where reports go from now on (`None`: nowhere); installs the hook (once).
pub fn set_dir(dir: Option<PathBuf>) {
    *crate::instance::lock(&DIR) = dir;
    install();
}

pub fn install() {
    HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let payload = info.payload();
            let message = payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "unknown panic".into());
            let at = info.location().map_or_else(|| "unknown".into(), |l| l.to_string());
            let thread = std::thread::current().name().unwrap_or("unnamed").to_owned();
            let path = write(&message, &at, &thread).unwrap_or_default();
            if let Ok(mut last) = LAST.try_lock() {
                *last = Some((message.clone(), path.clone()));
            }
            log!("panic at {at} on thread {thread}: {message}{}", if path.is_empty() { String::new() } else { format!(" (report: {path})") });
        }));
    });
}

fn write(message: &str, at: &str, thread: &str) -> Option<String> {
    let dir = DIR.try_lock().ok()?.clone()?;
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let report = format!(
        "Mantou core panic\n\nmessage: {message}\nat: {at}\nthread: {thread}\ncore: {} (ABI {})\nos: {}-{}\ntime: {ms} (ms since the Unix epoch)\n\nbacktrace:\n{}\n",
        env!("CARGO_PKG_VERSION"),
        crate::ABI_VERSION,
        std::env::consts::OS,
        std::env::consts::ARCH,
        Backtrace::force_capture(),
    );
    std::fs::create_dir_all(&dir).ok()?;
    let file = dir.join(format!("core-{ms}-{}.txt", std::process::id()));
    std::fs::write(&file, report).ok()?;
    Some(file.to_string_lossy().into_owned())
}

/// The panic `guard` just caught: its message and report path.
pub fn take() -> Option<(String, String)> {
    crate::instance::lock(&LAST).take()
}
