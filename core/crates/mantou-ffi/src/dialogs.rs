//! Whether a dialog can be shown at all (dunkbing/mantou#28). On Linux, rfd asks the desktop portal over D-Bus,
//! then runs zenity, for file dialogs, and runs zenity for message boxes; with neither it answers as if the
//! person cancelled. The core checks first, so the app hears "can't show one" instead of a cancel.
//! macOS and Windows always have them.

use std::path::{Path, PathBuf};

/// What can be shown: (file dialogs, message boxes).
pub fn available() -> (bool, bool) {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        return (true, true);
    }
    linux(&|k| std::env::var(k).ok().filter(|v| !v.is_empty()), Path::new("/"))
}

/// Why `kind` ("files" or "messages") can't be shown, for the app's error.
pub fn missing(kind: &str) -> String {
    if kind == "messages" {
        "no message box can be shown: install zenity".into()
    } else {
        "no file dialog can be shown: install xdg-desktop-portal with a backend (gtk, gnome or kde), or zenity".into()
    }
}

/// The check, with the environment and the filesystem's root given (for tests).
fn linux(env: &dyn Fn(&str) -> Option<String>, root: &Path) -> (bool, bool) {
    let zenity = on_path(env, root, "zenity");
    (zenity || portal_file_chooser(env, root), zenity)
}

fn under(root: &Path, p: &str) -> PathBuf {
    root.join(p.trim_start_matches('/'))
}

fn on_path(env: &dyn Fn(&str) -> Option<String>, root: &Path, program: &str) -> bool {
    env("PATH").is_some_and(|path| path.split(':').filter(|d| !d.is_empty()).any(|d| executable(&under(root, d).join(program))))
}

#[cfg(unix)]
fn executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable(p: &Path) -> bool {
    p.is_file()
}

/// A portal can show a file dialog: inside Flatpak; or with a session bus, the portal's D-Bus service, and a
/// backend that implements the file chooser.
fn portal_file_chooser(env: &dyn Fn(&str) -> Option<String>, root: &Path) -> bool {
    if under(root, "/.flatpak-info").exists() {
        return true;
    }
    let bus = env("DBUS_SESSION_BUS_ADDRESS").is_some() || env("XDG_RUNTIME_DIR").is_some_and(|d| under(root, &d).join("bus").exists());
    if !bus {
        return false;
    }
    let home = env("XDG_DATA_HOME").or_else(|| env("HOME").map(|h| format!("{h}/.local/share")));
    let system = env("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    let dirs: Vec<PathBuf> = home.iter().map(String::as_str).chain(system.split(':')).filter(|d| !d.is_empty()).map(|d| under(root, d)).collect();
    let service = dirs.iter().any(|d| d.join("dbus-1/services/org.freedesktop.portal.Desktop.service").exists());
    let chooser = dirs.iter().any(|d| {
        std::fs::read_dir(d.join("xdg-desktop-portal/portals")).is_ok_and(|entries| {
            entries.flatten().any(|e| {
                e.path().extension().is_some_and(|x| x == "portal") && std::fs::read_to_string(e.path()).is_ok_and(|s| s.contains("org.freedesktop.impl.portal.FileChooser"))
            })
        })
    });
    service && chooser
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn check(vars: &[(&str, &str)], files: &[(&str, &str, bool)]) -> (bool, bool) {
        let root = std::env::temp_dir().join(format!("mantou-dialogs-{}-{}", std::process::id(), rand_suffix()));
        for (p, body, exec) in files {
            let f = under(&root, p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(&f, body).unwrap();
            #[cfg(unix)]
            if *exec {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let vars: HashMap<String, String> = vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let r = linux(&|k| vars.get(k).cloned(), &root);
        let _ = std::fs::remove_dir_all(&root);
        r
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    const SERVICE: (&str, &str, bool) = ("/usr/share/dbus-1/services/org.freedesktop.portal.Desktop.service", "[D-BUS Service]", false);
    const GTK: (&str, &str, bool) = ("/usr/share/xdg-desktop-portal/portals/gtk.portal", "[portal]\nInterfaces=org.freedesktop.impl.portal.FileChooser;org.freedesktop.impl.portal.AppChooser;", false);

    #[test]
    fn nothing_installed() {
        assert_eq!(check(&[("PATH", "/usr/bin")], &[]), (false, false));
    }

    #[test]
    fn zenity_shows_both() {
        assert_eq!(check(&[("PATH", "/bin:/usr/bin")], &[("/usr/bin/zenity", "", true)]), (true, true));
        // Not executable: not there.
        assert_eq!(check(&[("PATH", "/usr/bin")], &[("/usr/bin/zenity", "", false)]), (false, false));
    }

    #[test]
    fn a_portal_shows_files_only() {
        assert_eq!(check(&[("PATH", "/usr/bin"), ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus")], &[SERVICE, GTK]), (true, false));
        // The session bus found from XDG_RUNTIME_DIR.
        assert_eq!(check(&[("XDG_RUNTIME_DIR", "/run/user/1000")], &[SERVICE, GTK, ("/run/user/1000/bus", "", false)]), (true, false));
    }

    #[test]
    fn a_portal_needs_a_bus_a_service_and_a_file_chooser() {
        let bus = ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/x");
        assert_eq!(check(&[], &[SERVICE, GTK]), (false, false));
        assert_eq!(check(&[bus], &[GTK]), (false, false));
        assert_eq!(check(&[bus], &[SERVICE]), (false, false));
        let no_chooser = ("/usr/share/xdg-desktop-portal/portals/wlr.portal", "[portal]\nInterfaces=org.freedesktop.impl.portal.Screenshot;", false);
        assert_eq!(check(&[bus], &[SERVICE, no_chooser]), (false, false));
        // XDG_DATA_DIRS is followed.
        let kde = ("/opt/kde/share/xdg-desktop-portal/portals/kde.portal", "Interfaces=org.freedesktop.impl.portal.FileChooser", false);
        assert_eq!(check(&[bus, ("XDG_DATA_DIRS", "/opt/kde/share:/usr/share")], &[SERVICE, kde]), (true, false));
    }

    #[test]
    fn flatpak_has_the_portal() {
        assert_eq!(check(&[], &[("/.flatpak-info", "", false)]), (true, false));
    }
}
