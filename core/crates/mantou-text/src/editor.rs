//! Text editing for input nodes (design §8.3): parley's PlainEditor (caret,
//! selection and movement by grapheme, word and line, hit-testing, IME
//! composition), plus what Mantou adds: its text styles, undo and redo with
//! typing grouped, a length limit, read-only, single-line inputs (newlines
//! become spaces) and scrolling that keeps the caret in view. Lengths are
//! logical px, relative to the input's content box.

use std::borrow::Cow;

use parley::{FontFamily, FontStyle, FontWeight, Layout, LineHeight, PlainEditor, StyleProperty};

use crate::{FAMILY, PlacedGlyph, TextEngine, TextStyle};

const CARET_WIDTH: f32 = 1.5;
const UNDO_LIMIT: usize = 200;

#[derive(Clone, Debug, PartialEq)]
struct Snapshot {
    text: String,
    anchor: usize,
    focus: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Edit {
    Typing,
    Other,
}

pub struct Editor {
    ed: PlainEditor<()>,
    style: TextStyle,
    pub multiline: bool,
    pub read_only: bool,
    /// Maximum length in characters; 0 = no limit.
    pub max_len: usize,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    last_edit: Option<Edit>,
    /// How far the content is scrolled (x for single-line, y for multiline).
    scroll: [f32; 2],
    size: [f32; 2],
}

/// Rectangles are [x0, y0, x1, y1] in logical px from the content box's top
/// left, already scrolled.
pub type Rect = [f32; 4];

impl Editor {
    pub fn new(style: &TextStyle) -> Editor {
        let mut e = Editor {
            ed: PlainEditor::new(style.size),
            style: *style,
            multiline: false,
            read_only: false,
            max_len: 0,
            undo: Vec::new(),
            redo: Vec::new(),
            last_edit: None,
            scroll: [0.0; 2],
            size: [0.0; 2],
        };
        e.apply_style();
        e
    }

    fn apply_style(&mut self) {
        let s = self.style;
        let styles = self.ed.edit_styles();
        styles.insert(StyleProperty::FontFamily(FontFamily::Source(Cow::Borrowed(FAMILY))));
        styles.insert(StyleProperty::FontSize(s.size));
        styles.insert(StyleProperty::FontWeight(FontWeight::new(s.weight)));
        styles.insert(StyleProperty::FontStyle(if s.italic { FontStyle::Italic } else { FontStyle::Normal }));
        styles.insert(StyleProperty::LineHeight(if s.line_height > 0.0 {
            LineHeight::FontSizeRelative(s.line_height)
        } else {
            LineHeight::MetricsRelative(1.0)
        }));
    }

    pub fn set_style(&mut self, style: &TextStyle) {
        if *style != self.style {
            self.style = *style;
            self.apply_style();
        }
    }

    /// Sets the content box size; multiline text wraps at its width.
    pub fn set_size(&mut self, width: f32, height: f32) {
        self.size = [width.max(0.0), height.max(0.0)];
        self.ed.set_width(if self.multiline { Some(self.size[0]) } else { None });
    }

    pub fn set_multiline(&mut self, multiline: bool) {
        if self.multiline != multiline {
            self.multiline = multiline;
            let [w, h] = self.size;
            self.set_size(w, h);
        }
    }

    /// The text, without an IME composition in progress.
    pub fn text(&self) -> String {
        self.ed.text().to_string()
    }

    pub fn is_composing(&self) -> bool {
        self.ed.is_composing()
    }

    fn clean<'a>(&self, s: &'a str) -> Cow<'a, str> {
        if self.multiline {
            Cow::Borrowed(s)
        } else {
            Cow::Owned(s.replace(['\r', '\n'], " "))
        }
    }

    /// Replaces the text (from the app, not the user): the caret goes to the
    /// end, and the undo history is cleared.
    pub fn set_text(&mut self, engine: &mut TextEngine, text: &str) {
        let t = self.clean(text).into_owned();
        self.ed.set_text(&t);
        self.ed.driver(&mut engine.fcx, &mut engine.lcx).move_to_text_end();
        self.undo.clear();
        self.redo.clear();
        self.last_edit = None;
    }

    /// Replaces the text from the app after the user has edited it (a
    /// controlled value): one undo step, and the caret stays where it was,
    /// clamped to the new text.
    pub fn replace(&mut self, engine: &mut TextEngine, text: &str) {
        if self.ed.is_composing() {
            self.ed.driver(&mut engine.fcx, &mut engine.lcx).clear_compose();
        }
        let t = self.clean(text).into_owned();
        if t == self.ed.raw_text() {
            return;
        }
        self.checkpoint(Edit::Other);
        self.ed.set_text(&t); // keeps the selection's offsets, clamped
        self.last_edit = None;
    }

    fn snapshot(&self) -> Snapshot {
        let sel = self.ed.raw_selection();
        Snapshot { text: self.ed.raw_text().to_owned(), anchor: sel.anchor().index(), focus: sel.focus().index() }
    }

    fn restore(&mut self, engine: &mut TextEngine, s: Snapshot) {
        self.ed.set_text(&s.text);
        self.ed.driver(&mut engine.fcx, &mut engine.lcx).select_byte_range(s.anchor, s.focus);
    }

    fn checkpoint(&mut self, kind: Edit) {
        if kind == Edit::Typing && self.last_edit == Some(Edit::Typing) {
            return;
        }
        let s = self.snapshot();
        if self.undo.last() != Some(&s) {
            self.undo.push(s);
            if self.undo.len() > UNDO_LIMIT {
                self.undo.remove(0);
            }
        }
        self.redo.clear();
        self.last_edit = Some(kind);
    }

    /// Ends the current typing group (after moving the caret, for example).
    fn moved(&mut self) {
        self.last_edit = None;
    }

    /// Inserts text at the caret, replacing the selection. Returns whether the text changed.
    pub fn insert(&mut self, engine: &mut TextEngine, text: &str) -> bool {
        if self.read_only || text.is_empty() {
            return false;
        }
        let mut t = self.clean(text).into_owned();
        if self.max_len > 0 {
            let selected = self.ed.selected_text().map_or(0, |s| s.chars().count());
            let room = self.max_len.saturating_sub(self.text().chars().count() - selected);
            t = t.chars().take(room).collect();
            if t.is_empty() {
                return false;
            }
        }
        let word_break = t.chars().any(char::is_whitespace);
        self.checkpoint(if word_break { Edit::Other } else { Edit::Typing });
        self.ed.driver(&mut engine.fcx, &mut engine.lcx).insert_or_replace_selection(&t);
        if word_break {
            self.last_edit = None;
        }
        true
    }

    /// Deletes backwards (a character, or a word); returns whether the text changed.
    pub fn backspace(&mut self, engine: &mut TextEngine, word: bool) -> bool {
        self.delete_with(engine, |d| if word { d.backdelete_word() } else { d.backdelete() })
    }

    /// Deletes forwards (a character, or a word); returns whether the text changed.
    pub fn delete(&mut self, engine: &mut TextEngine, word: bool) -> bool {
        self.delete_with(engine, |d| if word { d.delete_word() } else { d.delete() })
    }

    fn delete_with(&mut self, engine: &mut TextEngine, f: impl FnOnce(&mut parley::PlainEditorDriver<'_, ()>)) -> bool {
        if self.read_only {
            return false;
        }
        let before = self.ed.raw_text().to_owned();
        self.checkpoint(Edit::Other);
        f(&mut self.ed.driver(&mut engine.fcx, &mut engine.lcx));
        let changed = self.ed.raw_text() != before;
        if !changed {
            self.undo.pop();
        }
        self.last_edit = None;
        changed
    }

    /// Deletes back to the start of the line (or the selection).
    pub fn backspace_line(&mut self, engine: &mut TextEngine) -> bool {
        self.delete_with(engine, |d| {
            d.select_to_line_start();
            d.delete_selection();
        })
    }

    /// Cuts the selection; returns the text removed.
    pub fn cut(&mut self, engine: &mut TextEngine) -> Option<String> {
        let text = self.ed.selected_text()?.to_owned();
        if self.read_only {
            return None;
        }
        self.checkpoint(Edit::Other);
        self.ed.driver(&mut engine.fcx, &mut engine.lcx).delete_selection();
        self.last_edit = None;
        Some(text)
    }

    pub fn selected_text(&self) -> Option<String> {
        self.ed.selected_text().map(str::to_owned)
    }

    pub fn undo(&mut self, engine: &mut TextEngine) -> bool {
        let Some(prev) = self.undo.pop() else { return false };
        self.redo.push(self.snapshot());
        self.restore(engine, prev);
        self.last_edit = None;
        true
    }

    pub fn redo(&mut self, engine: &mut TextEngine) -> bool {
        let Some(next) = self.redo.pop() else { return false };
        self.undo.push(self.snapshot());
        self.restore(engine, next);
        self.last_edit = None;
        true
    }

    /// Runs a caret movement or selection change (not an edit).
    pub fn navigate(&mut self, engine: &mut TextEngine, f: impl FnOnce(&mut parley::PlainEditorDriver<'_, ()>)) {
        f(&mut self.ed.driver(&mut engine.fcx, &mut engine.lcx));
        self.moved();
    }

    /// Points are logical px relative to the content box (the scroll is undone here).
    fn unscroll(&self, x: f32, y: f32) -> (f32, f32) {
        (x + self.scroll[0], y + self.scroll[1])
    }

    pub fn move_to_point(&mut self, engine: &mut TextEngine, x: f32, y: f32) {
        let (x, y) = self.unscroll(x, y);
        self.navigate(engine, |d| d.move_to_point(x, y));
    }

    pub fn extend_to_point(&mut self, engine: &mut TextEngine, x: f32, y: f32) {
        let (x, y) = self.unscroll(x, y);
        self.navigate(engine, |d| d.extend_selection_to_point(x, y));
    }

    pub fn select_word_at(&mut self, engine: &mut TextEngine, x: f32, y: f32) {
        let (x, y) = self.unscroll(x, y);
        self.navigate(engine, |d| d.select_word_at_point(x, y));
    }

    pub fn select_line_at(&mut self, engine: &mut TextEngine, x: f32, y: f32) {
        let (x, y) = self.unscroll(x, y);
        self.navigate(engine, |d| d.select_line_at_point(x, y));
    }

    /// Shows an IME composition at the caret (`cursor`: a byte range within it).
    pub fn set_compose(&mut self, engine: &mut TextEngine, text: &str, cursor: Option<(usize, usize)>) {
        if self.read_only {
            return;
        }
        let mut d = self.ed.driver(&mut engine.fcx, &mut engine.lcx);
        if text.is_empty() {
            d.clear_compose();
        } else {
            d.set_compose(text, cursor);
        }
    }

    /// Commits IME text: ends the composition and inserts it.
    pub fn commit(&mut self, engine: &mut TextEngine, text: &str) -> bool {
        if self.ed.is_composing() {
            self.ed.driver(&mut engine.fcx, &mut engine.lcx).clear_compose();
        }
        self.insert(engine, text)
    }

    fn refresh(&mut self, engine: &mut TextEngine) {
        self.ed.refresh_layout(&mut engine.fcx, &mut engine.lcx);
    }

    fn layout(&mut self, engine: &mut TextEngine) -> &Layout<()> {
        self.ed.layout(&mut engine.fcx, &mut engine.lcx)
    }

    /// The height of the text (at least one line).
    pub fn content_height(&mut self, engine: &mut TextEngine) -> f32 {
        let h = self.layout(engine).height();
        h.max(self.line_height(engine))
    }

    /// The width of the widest line.
    pub fn content_width(&mut self, engine: &mut TextEngine) -> f32 {
        self.layout(engine).full_width()
    }

    /// The text's height when wrapped at `width` (multiline), for measuring.
    pub fn measure_height(&mut self, engine: &mut TextEngine, width: f32) -> f32 {
        if !self.multiline {
            return self.line_height(engine);
        }
        self.ed.set_width(Some(width.max(0.0)));
        let h = self.content_height(engine);
        self.ed.set_width(Some(self.size[0]));
        h
    }

    /// One line's height for the style.
    pub fn line_height(&self, engine: &mut TextEngine) -> f32 {
        let l = engine.layout("M", &self.style, None);
        l.height
    }

    /// Scrolls so that the caret is inside the content box.
    pub fn keep_caret_visible(&mut self, engine: &mut TextEngine) {
        self.refresh(engine);
        let Some(c) = self.ed.cursor_geometry(CARET_WIDTH) else { return };
        let [w, h] = self.size;
        if self.multiline {
            let (top, bottom) = (c.y0 as f32, c.y1 as f32);
            let max = (self.layout(engine).height() - h).max(0.0);
            if top < self.scroll[1] {
                self.scroll[1] = top;
            } else if bottom > self.scroll[1] + h {
                self.scroll[1] = bottom - h;
            }
            self.scroll[1] = self.scroll[1].clamp(0.0, max);
            self.scroll[0] = 0.0;
        } else {
            let x = c.x0 as f32;
            let max = (self.layout(engine).full_width() + CARET_WIDTH - w).max(0.0);
            if x < self.scroll[0] {
                self.scroll[0] = x;
            } else if x + CARET_WIDTH > self.scroll[0] + w {
                self.scroll[0] = x + CARET_WIDTH - w;
            }
            self.scroll[0] = self.scroll[0].clamp(0.0, max);
            self.scroll[1] = 0.0;
        }
    }

    fn shift(&self, r: parley::BoundingBox) -> Rect {
        let [sx, sy] = self.scroll;
        [r.x0 as f32 - sx, r.y0 as f32 - sy, r.x1 as f32 - sx, r.y1 as f32 - sy]
    }

    /// The glyphs to draw, scrolled.
    pub fn glyphs(&mut self, engine: &mut TextEngine) -> Vec<PlacedGlyph> {
        self.refresh(engine);
        let [sx, sy] = self.scroll;
        let layout = self.ed.try_layout().expect("refreshed").clone();
        let (lines, _) = engine.glyphs_of(&layout, usize::MAX);
        lines.into_iter().flatten().map(|g| PlacedGlyph { x: g.x - sx, y: g.y - sy, ..g }).collect()
    }

    pub fn caret(&mut self, engine: &mut TextEngine) -> Option<Rect> {
        self.refresh(engine);
        if !self.ed.is_cursor_visible() {
            return None;
        }
        self.ed.cursor_geometry(CARET_WIDTH).map(|r| self.shift(r))
    }

    pub fn selection(&mut self, engine: &mut TextEngine) -> Vec<Rect> {
        self.refresh(engine);
        self.ed.selection_geometry().into_iter().map(|(r, _)| self.shift(r)).collect()
    }

    /// Where an IME composition is, to underline it.
    pub fn compose(&mut self, engine: &mut TextEngine) -> Vec<Rect> {
        let Some(range) = self.ed.raw_compose().clone() else { return Vec::new() };
        let layout = self.layout(engine).clone();
        let sel = parley::Selection::new(
            parley::Cursor::from_byte_index(&layout, range.start, parley::Affinity::Downstream),
            parley::Cursor::from_byte_index(&layout, range.end, parley::Affinity::Upstream),
        );
        sel.geometry(&layout).into_iter().map(|(r, _)| self.shift(r)).collect()
    }

    /// Where the IME's candidate window should go: the caret, in content-box px.
    pub fn ime_area(&mut self, engine: &mut TextEngine) -> Rect {
        self.refresh(engine);
        self.shift(self.ed.ime_cursor_area())
    }

    /// The caret's byte range in the text (anchor, focus), for tests.
    pub fn selection_range(&self) -> (usize, usize) {
        let s = self.ed.raw_selection();
        (s.anchor().index(), s.focus().index())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn editor(multiline: bool) -> (TextEngine, Editor) {
        let mut e = TextEngine::new();
        let mut ed = Editor::new(&TextStyle::default());
        ed.set_multiline(multiline);
        ed.set_size(120.0, 60.0);
        ed.set_text(&mut e, "");
        (e, ed)
    }

    #[test]
    fn typing_moving_and_deleting() {
        let (mut e, mut ed) = editor(false);
        for ch in ["H", "e", "l", "l", "o"] {
            assert!(ed.insert(&mut e, ch));
        }
        assert_eq!(ed.text(), "Hello");
        ed.navigate(&mut e, |d| d.move_left());
        ed.navigate(&mut e, |d| d.move_left());
        ed.insert(&mut e, "X");
        assert_eq!(ed.text(), "HelXlo");
        assert!(ed.backspace(&mut e, false));
        assert!(ed.delete(&mut e, false));
        assert_eq!(ed.text(), "Helo");
        ed.navigate(&mut e, |d| d.select_all());
        assert_eq!(ed.selected_text().as_deref(), Some("Helo"));
        ed.insert(&mut e, "Bye");
        assert_eq!(ed.text(), "Bye");
    }

    #[test]
    fn word_movement_and_deletion() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "one two three");
        ed.backspace(&mut e, true);
        assert_eq!(ed.text(), "one two ");
        ed.navigate(&mut e, |d| d.move_to_text_start());
        ed.navigate(&mut e, |d| d.move_word_right());
        ed.navigate(&mut e, |d| d.select_word_right());
        assert!(ed.selected_text().is_some_and(|s| s.contains("two")));
    }

    #[test]
    fn undo_groups_typing_and_redo_restores() {
        let (mut e, mut ed) = editor(false);
        for ch in "hello".chars() {
            ed.insert(&mut e, &ch.to_string());
        }
        ed.insert(&mut e, " ");
        for ch in "world".chars() {
            ed.insert(&mut e, &ch.to_string());
        }
        assert_eq!(ed.text(), "hello world");
        assert!(ed.undo(&mut e));
        assert_eq!(ed.text(), "hello ", "a word typed is one step");
        assert!(ed.undo(&mut e));
        assert!(ed.undo(&mut e));
        assert_eq!(ed.text(), "");
        assert!(!ed.undo(&mut e));
        assert!(ed.redo(&mut e));
        assert!(ed.redo(&mut e));
        assert!(ed.redo(&mut e));
        assert_eq!(ed.text(), "hello world");
    }

    #[test]
    fn single_line_turns_newlines_into_spaces_and_multiline_keeps_them() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "a\nb");
        assert_eq!(ed.text(), "a b");
        let (mut e, mut ed) = editor(true);
        ed.insert(&mut e, "a\nb");
        assert_eq!(ed.text(), "a\nb");
        assert!(ed.content_height(&mut e) > ed.line_height(&mut e) * 1.5);
    }

    #[test]
    fn max_length_and_read_only() {
        let (mut e, mut ed) = editor(false);
        ed.max_len = 5;
        ed.insert(&mut e, "abcdefgh");
        assert_eq!(ed.text(), "abcde");
        assert!(!ed.insert(&mut e, "z"));
        ed.read_only = true;
        assert!(!ed.backspace(&mut e, false));
        assert_eq!(ed.text(), "abcde");
    }

    #[test]
    fn replacing_keeps_the_caret_and_is_one_undo_step() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "hello");
        ed.navigate(&mut e, |d| d.move_left());
        ed.replace(&mut e, "HELLO");
        assert_eq!(ed.text(), "HELLO");
        assert_eq!(ed.selection_range(), (4, 4));
        ed.replace(&mut e, "HI");
        assert_eq!(ed.selection_range(), (2, 2), "clamped");
        ed.undo(&mut e);
        assert_eq!(ed.text(), "HELLO");
    }

    #[test]
    fn ime_composition_then_commit() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "a");
        ed.set_compose(&mut e, "にほ", Some((6, 6)));
        assert!(ed.is_composing());
        assert_eq!(ed.text(), "a", "the composition isn't the text yet");
        assert!(!ed.compose(&mut e).is_empty());
        ed.commit(&mut e, "日本");
        assert!(!ed.is_composing());
        assert_eq!(ed.text(), "a日本");
    }

    #[test]
    fn the_caret_stays_in_view_when_typing_past_the_edge() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "a long line of text that is much wider than the box");
        ed.keep_caret_visible(&mut e);
        let caret = ed.caret(&mut e).unwrap();
        assert!(caret[0] >= 0.0 && caret[2] <= 120.0 + 0.01, "{caret:?}");
        assert!(ed.glyphs(&mut e).first().unwrap().x < 0.0, "scrolled left");
        ed.navigate(&mut e, |d| d.move_to_text_start());
        ed.keep_caret_visible(&mut e);
        assert!(ed.caret(&mut e).unwrap()[0] < 1.0);
    }

    #[test]
    fn pointer_places_the_caret_and_double_click_selects_a_word() {
        let (mut e, mut ed) = editor(false);
        ed.insert(&mut e, "alpha beta");
        ed.move_to_point(&mut e, 0.0, 5.0);
        assert_eq!(ed.selection_range(), (0, 0));
        ed.select_word_at(&mut e, 60.0, 5.0);
        assert_eq!(ed.selected_text().as_deref(), Some("beta"));
        ed.move_to_point(&mut e, 0.0, 5.0);
        ed.extend_to_point(&mut e, 200.0, 5.0);
        assert_eq!(ed.selected_text().as_deref(), Some("alpha beta"));
        assert!(!ed.selection(&mut e).is_empty());
    }
}
