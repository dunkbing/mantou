//! Written by schema/gen.ts from schema/protocol.ts. Don't edit it; change the schema and run `bun run gen`.

#![allow(missing_docs, dead_code)]

pub const PROTOCOL_VERSION: u32 = 13;

pub mod op {
    /// Create a node; it starts detached.
    pub const CREATE: u32 = 1;
    /// Insert or move child into parent before sibling `before` (0 = append). A node already in place is left alone.
    pub const INSERT: u32 = 2;
    /// Detach child from parent. The node stays alive until RELEASE.
    pub const REMOVE: u32 = 3;
    /// Free the node; it is detached first. Its children are detached, not freed.
    pub const RELEASE: u32 = 4;
    /// Set one style property on the node (overrides its shared style).
    pub const STYLE: u32 = 5;
    /// Remove the node's own value for a property.
    pub const STYLE_RESET: u32 = 6;
    /// Define (or redefine) a shared style.
    pub const STYLE_DEF: u32 = 7;
    /// Apply a shared style to the node (0 = none).
    pub const STYLE_USE: u32 = 8;
    /// Which events the node has handlers for (EventMask bits).
    pub const LISTEN: u32 = 9;
    /// Make the node the window's root (0 = none).
    pub const SET_ROOT: u32 = 10;
    /// The window's background colour (sRGB, 0–1).
    pub const CLEAR_COLOR: u32 = 11;
    /// The window's title.
    pub const TITLE: u32 = 12;
    /// The content of a Text node.
    pub const TEXT: u32 = 13;
    /// An Input's text, from the app. Applied only when `rev` (the last TEXT_CHANGED rev the app has seen, 0 before any) is at least the input's, so a value derived from an older edit never undoes newer typing.
    pub const VALUE: u32 = 14;
    /// What an empty Input shows.
    pub const PLACEHOLDER: u32 = 15;
    /// An Input's options: InputFlag bits, and its maximum length in characters (0 = none).
    pub const INPUT_OPTIONS: u32 = 16;
    /// Focus an Input (0 = blur the focused one). FOCUS and BLUR events follow.
    pub const FOCUS: u32 = 17;
    /// Scroll a scroll view to an offset (NaN keeps that axis), or by it with ScrollFlag.By. Clamped, and applied after the batch's layout.
    pub const SCROLL_TO: u32 = 19;
    /// Scroll the node's scroll-view ancestors so it shows (ScrollBlock), after the batch's layout.
    pub const SCROLL_INTO_VIEW: u32 = 20;
    /// Register a font file (TTF, OTF or a collection) with the instance; text uses it by its family name.
    pub const FONT: u32 = 21;
    /// Define a font family id (1 and up) for fontFamily styles: a comma-separated list of family names, tried in order before Mantou's own fonts.
    pub const FONT_FAMILY: u32 = 22;
    /// Resize the window's content area (logical px). A headless instance resizes its viewport.
    pub const WINDOW_SIZE: u32 = 23;
    /// The window's smallest and largest content size (logical px, 0 = no limit), and WindowFlag bits.
    pub const WINDOW_LIMITS: u32 = 24;
    /// An Image's source: a PNG, JPEG, WebP or SVG file the core reads and decodes. IMAGE_LOAD or IMAGE_ERROR follows.
    pub const IMAGE_PATH: u32 = 25;
    /// An Image's source as the file's bytes.
    pub const IMAGE_DATA: u32 = 26;
    /// When the node's `prop` changes, animate to the new value over `duration` ms (Easing; 0 = no transition). Animatable: opacity, translateX, translateY, scale, backgroundColor, borderColor, color.
    pub const TRANSITION: u32 = 27;
    /// Animate the node's `prop` from `from` to `to` (an f32's bits, or a colour), `iterations` times (Infinity = forever; AnimateFlag.Alternate goes back and forth), then back to its style. ANIMATION_END(animation) follows.
    pub const ANIMATE: u32 = 28;
    /// Select an Input's text from `anchor` to `focus` (the caret), in UTF-16 code units like the DOM's selectionStart (clamped; equal = a caret).
    pub const SELECT: u32 = 29;
    /// Make a view a focus scope (FocusScopeFlag bits; 0 = not one): Tab stays inside the topmost scope on screen, and the focus goes back where it was when the scope leaves the screen.
    pub const FOCUS_SCOPE: u32 = 18;
    /// What assistive technology (screen readers) is told about the node: its AccessRole (0 = the default for its kind), AccessFlag bits, and its name (empty = taken from the text inside it).
    pub const ACCESS: u32 = 30;
}

pub fn op_name(code: u32) -> &'static str {
    match code {
        1 => "CREATE",
        2 => "INSERT",
        3 => "REMOVE",
        4 => "RELEASE",
        5 => "STYLE",
        6 => "STYLE_RESET",
        7 => "STYLE_DEF",
        8 => "STYLE_USE",
        9 => "LISTEN",
        10 => "SET_ROOT",
        11 => "CLEAR_COLOR",
        12 => "TITLE",
        13 => "TEXT",
        14 => "VALUE",
        15 => "PLACEHOLDER",
        16 => "INPUT_OPTIONS",
        17 => "FOCUS",
        19 => "SCROLL_TO",
        20 => "SCROLL_INTO_VIEW",
        21 => "FONT",
        22 => "FONT_FAMILY",
        23 => "WINDOW_SIZE",
        24 => "WINDOW_LIMITS",
        25 => "IMAGE_PATH",
        26 => "IMAGE_DATA",
        27 => "TRANSITION",
        28 => "ANIMATE",
        29 => "SELECT",
        18 => "FOCUS_SCOPE",
        30 => "ACCESS",
        _ => "UNKNOWN",
    }
}

pub mod node_kind {
    pub const VIEW: u32 = 1;
    pub const TEXT: u32 = 2;
    pub const INPUT: u32 = 3;
    pub const IMAGE: u32 = 4;
}

pub mod event_mask {
    pub const PRESS: u32 = 1;
    pub const LAYOUT: u32 = 2;
    pub const SCROLL: u32 = 4;
    pub const HOVER: u32 = 8;
    pub const POINTER: u32 = 16;
    pub const DROP: u32 = 32;
}

pub mod scroll_flag {
    pub const BY: u32 = 1;
}

pub mod scroll_block {
    pub const NEAREST: u32 = 0;
    pub const START: u32 = 1;
    pub const CENTER: u32 = 2;
    pub const END: u32 = 3;
}

pub mod easing {
    pub const LINEAR: u32 = 0;
    pub const EASE: u32 = 1;
    pub const EASE_IN: u32 = 2;
    pub const EASE_OUT: u32 = 3;
    pub const EASE_IN_OUT: u32 = 4;
}

pub mod animate_flag {
    pub const ALTERNATE: u32 = 1;
}

pub mod window_flag {
    pub const NOT_RESIZABLE: u32 = 1;
}

pub mod access_role {
    pub const AUTO: u32 = 0;
    pub const NONE: u32 = 1;
    pub const BUTTON: u32 = 2;
    pub const CHECKBOX: u32 = 3;
    pub const SWITCH: u32 = 4;
    pub const RADIO: u32 = 5;
    pub const LINK: u32 = 6;
    pub const HEADING: u32 = 7;
    pub const LIST: u32 = 8;
    pub const LIST_ITEM: u32 = 9;
    pub const DIALOG: u32 = 10;
    pub const TAB: u32 = 11;
    pub const TAB_LIST: u32 = 12;
    pub const MENU: u32 = 13;
    pub const MENU_ITEM: u32 = 14;
    pub const IMAGE: u32 = 15;
    pub const GROUP: u32 = 16;
    pub const STATUS: u32 = 17;
    pub const ALERT: u32 = 18;
}

pub mod access_flag {
    pub const CHECKED: u32 = 1;
    pub const MIXED: u32 = 2;
    pub const SELECTED: u32 = 4;
    pub const DISABLED: u32 = 8;
    pub const HIDDEN: u32 = 16;
}

pub mod focus_scope_flag {
    pub const TRAP: u32 = 1;
    pub const RESTORE: u32 = 2;
}

pub mod input_flag {
    pub const MULTILINE: u32 = 1;
    pub const SECURE: u32 = 2;
    pub const READ_ONLY: u32 = 4;
}

pub mod key_modifier {
    pub const SHIFT: u32 = 1;
    pub const CONTROL: u32 = 2;
    pub const ALT: u32 = 4;
    pub const META: u32 = 8;
}

pub mod named_key {
    pub const ESCAPE: u32 = 0x110000;
    pub const ENTER: u32 = 0x110001;
    pub const ARROW_UP: u32 = 0x110002;
    pub const ARROW_DOWN: u32 = 0x110003;
    pub const ARROW_LEFT: u32 = 0x110004;
    pub const ARROW_RIGHT: u32 = 0x110005;
    pub const BACKSPACE: u32 = 0x110006;
    pub const DELETE: u32 = 0x110007;
    pub const TAB: u32 = 0x110008;
    pub const HOME: u32 = 0x110009;
    pub const END: u32 = 0x11000a;
    pub const PAGE_UP: u32 = 0x11000b;
    pub const PAGE_DOWN: u32 = 0x11000c;
    pub const UNIDENTIFIED: u32 = 0x11ffff;
}

pub mod unit {
    pub const PX: u32 = 0;
    pub const PERCENT: u32 = 1;
    pub const AUTO: u32 = 2;
}

pub mod event {
    /// The window opened. a = width px, b = height px, c = scale (f32).
    pub const WINDOW_READY: u32 = 1;
    /// The window's size changed. a = width px, b = height px, c = scale (f32).
    pub const RESIZED: u32 = 2;
    /// The pointer moved. b = x, c = y (f32, logical px).
    pub const POINTER_MOVE: u32 = 3;
    /// A button was pressed. a = button, b = x, c = y.
    pub const POINTER_DOWN: u32 = 4;
    /// A button was released. a = button, b = x, c = y.
    pub const POINTER_UP: u32 = 5;
    /// A key was pressed. a = key, b = repeat, c = modifiers (KeyModifier bits).
    pub const KEY_DOWN: u32 = 6;
    /// A key was released. a = key, c = modifiers.
    pub const KEY_UP: u32 = 7;
    /// The user asked to close the window.
    pub const CLOSE_REQUESTED: u32 = 8;
    /// The window's scale factor changed. c = scale (f32).
    pub const SCALE_CHANGED: u32 = 9;
    /// A press (down and up on the same node) on a node with a Press listener on its path. a = target node, b = x, c = y (f32, logical px).
    pub const PRESS: u32 = 10;
    /// The wheel or trackpad scrolled. a = node under the pointer (0 = none), b = dx, c = dy (f32, logical px; positive dy scrolls content up).
    pub const WHEEL: u32 = 11;
    /// An Input got the keyboard focus. a = input.
    pub const FOCUS: u32 = 12;
    /// An Input lost the keyboard focus. a = input.
    pub const BLUR: u32 = 13;
    /// The user changed an Input's text. a = input, b = rev (counts the user's edits), c = byte length; then the UTF-8 text, padded to words.
    pub const TEXT_CHANGED: u32 = 14;
    /// Enter in a single-line Input. a = input.
    pub const SUBMIT: u32 = 15;
    /// A scroll view with a Scroll listener scrolled (at most once per frame). a = scroll view, b = x, c = y (f32, logical px: the offset).
    pub const SCROLL: u32 = 17;
    /// An Image's source was decoded. a = image node, b = natural width, c = natural height (f32, logical px).
    pub const IMAGE_LOAD: u32 = 20;
    /// An Image's source couldn't be read or decoded. a = image node, c = byte length; then the UTF-8 message, padded to words.
    pub const IMAGE_ERROR: u32 = 21;
    /// The pointer came over a node with a Hover listener (or one of its descendants). Ancestors first. a = node.
    pub const POINTER_ENTER: u32 = 23;
    /// The pointer left a node with a Hover listener: it moved off, left the window, or the node moved, hid or was removed under it. Descendants first. a = node.
    pub const POINTER_LEAVE: u32 = 24;
    /// An ANIMATE finished (or was replaced or its node released). a = node, b = animation id.
    pub const ANIMATION_END: u32 = 22;
    /// A node with a Layout listener was laid out at a new box (or for the first time since it listened). a = node, b = x, c = y; then width, height (f32, logical px, from the window's top left).
    pub const LAYOUT: u32 = 16;
    /// A platform service (dialog, context menu) finished. a = request id, b = 0 answered or 1 cancelled, c = byte length; then the UTF-8 JSON answer, padded to words.
    pub const SERVICE_RESULT: u32 = 18;
    /// The user chose an item of the app menu. c = byte length; then the UTF-8 id of the menu item, padded to words.
    pub const MENU: u32 = 19;
    /// The pointer went down, up or moved, for a node whose path to the root has a Pointer listener. While a button is held, everything goes to the node that was pressed (even outside it); moves are coalesced into one per batch. a = target node, b = x, c = y (f32, logical px); then kind (0 down, 1 up, 2 move), button, buttons held (a bit per button), modifiers (KeyModifier bits), clicks (1, 2… for presses in a row at one spot).
    pub const NODE_POINTER: u32 = 25;
    /// Files are dragged over the window or dropped on it. The target is the topmost node under the pointer's last position with a Drop listener on its path. a = kind (0 files held over the window, 1 they left, 2 dropped), b = target node (0 none), c = byte length; then the UTF-8 JSON {x, y, files}, padded to words.
    pub const FILE_DROP: u32 = 26;
}

pub mod display {
    pub const FLEX: u32 = 0;
    pub const NONE: u32 = 1;
}

pub mod flex_direction {
    pub const ROW: u32 = 0;
    pub const COLUMN: u32 = 1;
    pub const ROW_REVERSE: u32 = 2;
    pub const COLUMN_REVERSE: u32 = 3;
}

pub mod flex_wrap {
    pub const NO_WRAP: u32 = 0;
    pub const WRAP: u32 = 1;
}

pub mod justify_content {
    pub const START: u32 = 0;
    pub const END: u32 = 1;
    pub const CENTER: u32 = 2;
    pub const SPACE_BETWEEN: u32 = 3;
    pub const SPACE_AROUND: u32 = 4;
    pub const SPACE_EVENLY: u32 = 5;
}

pub mod align_items {
    pub const STRETCH: u32 = 0;
    pub const START: u32 = 1;
    pub const END: u32 = 2;
    pub const CENTER: u32 = 3;
    pub const BASELINE: u32 = 4;
}

pub mod align_self {
    pub const AUTO: u32 = 0;
    pub const STRETCH: u32 = 1;
    pub const START: u32 = 2;
    pub const END: u32 = 3;
    pub const CENTER: u32 = 4;
    pub const BASELINE: u32 = 5;
}

pub mod position {
    pub const RELATIVE: u32 = 0;
    pub const ABSOLUTE: u32 = 1;
}

pub mod align_content {
    pub const STRETCH: u32 = 0;
    pub const START: u32 = 1;
    pub const END: u32 = 2;
    pub const CENTER: u32 = 3;
    pub const SPACE_BETWEEN: u32 = 4;
    pub const SPACE_AROUND: u32 = 5;
    pub const SPACE_EVENLY: u32 = 6;
}

pub mod text_align {
    pub const START: u32 = 0;
    pub const CENTER: u32 = 1;
    pub const END: u32 = 2;
}

pub mod font_style {
    pub const NORMAL: u32 = 0;
    pub const ITALIC: u32 = 1;
}

pub mod overflow {
    pub const VISIBLE: u32 = 0;
    pub const HIDDEN: u32 = 1;
    pub const SCROLL: u32 = 2;
}

pub mod scrollbar {
    pub const AUTO: u32 = 0;
    pub const NONE: u32 = 1;
}

pub mod object_fit {
    pub const FILL: u32 = 0;
    pub const CONTAIN: u32 = 1;
    pub const COVER: u32 = 2;
}

pub mod cursor {
    pub const AUTO: u32 = 0;
    pub const DEFAULT: u32 = 1;
    pub const POINTER: u32 = 2;
    pub const TEXT: u32 = 3;
    pub const GRAB: u32 = 4;
    pub const GRABBING: u32 = 5;
    pub const NOT_ALLOWED: u32 = 6;
    pub const MOVE: u32 = 7;
    pub const CROSSHAIR: u32 = 8;
    pub const WAIT: u32 = 9;
    pub const PROGRESS: u32 = 10;
    pub const HELP: u32 = 11;
    pub const EW_RESIZE: u32 = 12;
    pub const NS_RESIZE: u32 = 13;
    pub const NESW_RESIZE: u32 = 14;
    pub const NWSE_RESIZE: u32 = 15;
    pub const COL_RESIZE: u32 = 16;
    pub const ROW_RESIZE: u32 = 17;
    pub const NONE: u32 = 18;
}

pub mod text_decoration {
    pub const NONE: u32 = 0;
    pub const UNDERLINE: u32 = 1;
    pub const LINE_THROUGH: u32 = 2;
}

pub mod text_transform {
    pub const NONE: u32 = 0;
    pub const UPPERCASE: u32 = 1;
    pub const LOWERCASE: u32 = 2;
    pub const CAPITALIZE: u32 = 3;
}

pub mod white_space {
    pub const NORMAL: u32 = 0;
    pub const NOWRAP: u32 = 1;
}

pub mod text_overflow {
    pub const ELLIPSIS: u32 = 0;
    pub const CLIP: u32 = 1;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueKind {
    F32,
    Color,
    Length,
    /// A FONT_FAMILY id.
    Family,
    /// An enum with this many values.
    Enum(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(u32)]
pub enum Prop {
    Display = 1,
    FlexDirection = 2,
    FlexWrap = 3,
    JustifyContent = 4,
    AlignItems = 5,
    AlignSelf = 6,
    FlexGrow = 7,
    FlexShrink = 8,
    FlexBasis = 9,
    Width = 10,
    Height = 11,
    MinWidth = 12,
    MinHeight = 13,
    MaxWidth = 14,
    MaxHeight = 15,
    PaddingTop = 16,
    PaddingRight = 17,
    PaddingBottom = 18,
    PaddingLeft = 19,
    MarginTop = 20,
    MarginRight = 21,
    MarginBottom = 22,
    MarginLeft = 23,
    RowGap = 24,
    ColumnGap = 25,
    Position = 26,
    Top = 27,
    Right = 28,
    Bottom = 29,
    Left = 30,
    BackgroundColor = 31,
    Opacity = 32,
    AlignContent = 33,
    Color = 34,
    FontSize = 35,
    FontWeight = 36,
    LineHeight = 37,
    TextAlign = 38,
    MaxLines = 39,
    FontStyle = 40,
    Overflow = 41,
    BorderRadius = 42,
    BorderWidth = 43,
    BorderColor = 44,
    PlaceholderColor = 45,
    CaretColor = 46,
    SelectionColor = 47,
    Scrollbar = 48,
    ScrollbarColor = 49,
    FontFamily = 50,
    ShadowX = 51,
    ShadowY = 52,
    ShadowBlur = 53,
    ShadowSpread = 54,
    ShadowColor = 55,
    ObjectFit = 56,
    TranslateX = 57,
    TranslateY = 58,
    Scale = 59,
    Cursor = 60,
    TextDecoration = 61,
    LetterSpacing = 62,
    TextTransform = 63,
    WhiteSpace = 64,
    TextOverflow = 65,
}

impl Prop {
    pub const COUNT: usize = 65;

    pub fn from_code(code: u32) -> Option<Prop> {
        Some(match code {
            1 => Prop::Display,
            2 => Prop::FlexDirection,
            3 => Prop::FlexWrap,
            4 => Prop::JustifyContent,
            5 => Prop::AlignItems,
            6 => Prop::AlignSelf,
            7 => Prop::FlexGrow,
            8 => Prop::FlexShrink,
            9 => Prop::FlexBasis,
            10 => Prop::Width,
            11 => Prop::Height,
            12 => Prop::MinWidth,
            13 => Prop::MinHeight,
            14 => Prop::MaxWidth,
            15 => Prop::MaxHeight,
            16 => Prop::PaddingTop,
            17 => Prop::PaddingRight,
            18 => Prop::PaddingBottom,
            19 => Prop::PaddingLeft,
            20 => Prop::MarginTop,
            21 => Prop::MarginRight,
            22 => Prop::MarginBottom,
            23 => Prop::MarginLeft,
            24 => Prop::RowGap,
            25 => Prop::ColumnGap,
            26 => Prop::Position,
            27 => Prop::Top,
            28 => Prop::Right,
            29 => Prop::Bottom,
            30 => Prop::Left,
            31 => Prop::BackgroundColor,
            32 => Prop::Opacity,
            33 => Prop::AlignContent,
            34 => Prop::Color,
            35 => Prop::FontSize,
            36 => Prop::FontWeight,
            37 => Prop::LineHeight,
            38 => Prop::TextAlign,
            39 => Prop::MaxLines,
            40 => Prop::FontStyle,
            41 => Prop::Overflow,
            42 => Prop::BorderRadius,
            43 => Prop::BorderWidth,
            44 => Prop::BorderColor,
            45 => Prop::PlaceholderColor,
            46 => Prop::CaretColor,
            47 => Prop::SelectionColor,
            48 => Prop::Scrollbar,
            49 => Prop::ScrollbarColor,
            50 => Prop::FontFamily,
            51 => Prop::ShadowX,
            52 => Prop::ShadowY,
            53 => Prop::ShadowBlur,
            54 => Prop::ShadowSpread,
            55 => Prop::ShadowColor,
            56 => Prop::ObjectFit,
            57 => Prop::TranslateX,
            58 => Prop::TranslateY,
            59 => Prop::Scale,
            60 => Prop::Cursor,
            61 => Prop::TextDecoration,
            62 => Prop::LetterSpacing,
            63 => Prop::TextTransform,
            64 => Prop::WhiteSpace,
            65 => Prop::TextOverflow,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Prop::Display => "display",
            Prop::FlexDirection => "flexDirection",
            Prop::FlexWrap => "flexWrap",
            Prop::JustifyContent => "justifyContent",
            Prop::AlignItems => "alignItems",
            Prop::AlignSelf => "alignSelf",
            Prop::FlexGrow => "flexGrow",
            Prop::FlexShrink => "flexShrink",
            Prop::FlexBasis => "flexBasis",
            Prop::Width => "width",
            Prop::Height => "height",
            Prop::MinWidth => "minWidth",
            Prop::MinHeight => "minHeight",
            Prop::MaxWidth => "maxWidth",
            Prop::MaxHeight => "maxHeight",
            Prop::PaddingTop => "paddingTop",
            Prop::PaddingRight => "paddingRight",
            Prop::PaddingBottom => "paddingBottom",
            Prop::PaddingLeft => "paddingLeft",
            Prop::MarginTop => "marginTop",
            Prop::MarginRight => "marginRight",
            Prop::MarginBottom => "marginBottom",
            Prop::MarginLeft => "marginLeft",
            Prop::RowGap => "rowGap",
            Prop::ColumnGap => "columnGap",
            Prop::Position => "position",
            Prop::Top => "top",
            Prop::Right => "right",
            Prop::Bottom => "bottom",
            Prop::Left => "left",
            Prop::BackgroundColor => "backgroundColor",
            Prop::Opacity => "opacity",
            Prop::AlignContent => "alignContent",
            Prop::Color => "color",
            Prop::FontSize => "fontSize",
            Prop::FontWeight => "fontWeight",
            Prop::LineHeight => "lineHeight",
            Prop::TextAlign => "textAlign",
            Prop::MaxLines => "maxLines",
            Prop::FontStyle => "fontStyle",
            Prop::Overflow => "overflow",
            Prop::BorderRadius => "borderRadius",
            Prop::BorderWidth => "borderWidth",
            Prop::BorderColor => "borderColor",
            Prop::PlaceholderColor => "placeholderColor",
            Prop::CaretColor => "caretColor",
            Prop::SelectionColor => "selectionColor",
            Prop::Scrollbar => "scrollbar",
            Prop::ScrollbarColor => "scrollbarColor",
            Prop::FontFamily => "fontFamily",
            Prop::ShadowX => "shadowX",
            Prop::ShadowY => "shadowY",
            Prop::ShadowBlur => "shadowBlur",
            Prop::ShadowSpread => "shadowSpread",
            Prop::ShadowColor => "shadowColor",
            Prop::ObjectFit => "objectFit",
            Prop::TranslateX => "translateX",
            Prop::TranslateY => "translateY",
            Prop::Scale => "scale",
            Prop::Cursor => "cursor",
            Prop::TextDecoration => "textDecoration",
            Prop::LetterSpacing => "letterSpacing",
            Prop::TextTransform => "textTransform",
            Prop::WhiteSpace => "whiteSpace",
            Prop::TextOverflow => "textOverflow",
        }
    }

    pub fn kind(self) -> ValueKind {
        match self {
            Prop::Display => ValueKind::Enum(2),
            Prop::FlexDirection => ValueKind::Enum(4),
            Prop::FlexWrap => ValueKind::Enum(2),
            Prop::JustifyContent => ValueKind::Enum(6),
            Prop::AlignItems => ValueKind::Enum(5),
            Prop::AlignSelf => ValueKind::Enum(6),
            Prop::FlexGrow => ValueKind::F32,
            Prop::FlexShrink => ValueKind::F32,
            Prop::FlexBasis => ValueKind::Length,
            Prop::Width => ValueKind::Length,
            Prop::Height => ValueKind::Length,
            Prop::MinWidth => ValueKind::Length,
            Prop::MinHeight => ValueKind::Length,
            Prop::MaxWidth => ValueKind::Length,
            Prop::MaxHeight => ValueKind::Length,
            Prop::PaddingTop => ValueKind::Length,
            Prop::PaddingRight => ValueKind::Length,
            Prop::PaddingBottom => ValueKind::Length,
            Prop::PaddingLeft => ValueKind::Length,
            Prop::MarginTop => ValueKind::Length,
            Prop::MarginRight => ValueKind::Length,
            Prop::MarginBottom => ValueKind::Length,
            Prop::MarginLeft => ValueKind::Length,
            Prop::RowGap => ValueKind::Length,
            Prop::ColumnGap => ValueKind::Length,
            Prop::Position => ValueKind::Enum(2),
            Prop::Top => ValueKind::Length,
            Prop::Right => ValueKind::Length,
            Prop::Bottom => ValueKind::Length,
            Prop::Left => ValueKind::Length,
            Prop::BackgroundColor => ValueKind::Color,
            Prop::Opacity => ValueKind::F32,
            Prop::AlignContent => ValueKind::Enum(7),
            Prop::Color => ValueKind::Color,
            Prop::FontSize => ValueKind::F32,
            Prop::FontWeight => ValueKind::F32,
            Prop::LineHeight => ValueKind::F32,
            Prop::TextAlign => ValueKind::Enum(3),
            Prop::MaxLines => ValueKind::F32,
            Prop::FontStyle => ValueKind::Enum(2),
            Prop::Overflow => ValueKind::Enum(3),
            Prop::BorderRadius => ValueKind::F32,
            Prop::BorderWidth => ValueKind::F32,
            Prop::BorderColor => ValueKind::Color,
            Prop::PlaceholderColor => ValueKind::Color,
            Prop::CaretColor => ValueKind::Color,
            Prop::SelectionColor => ValueKind::Color,
            Prop::Scrollbar => ValueKind::Enum(2),
            Prop::ScrollbarColor => ValueKind::Color,
            Prop::FontFamily => ValueKind::Family,
            Prop::ShadowX => ValueKind::F32,
            Prop::ShadowY => ValueKind::F32,
            Prop::ShadowBlur => ValueKind::F32,
            Prop::ShadowSpread => ValueKind::F32,
            Prop::ShadowColor => ValueKind::Color,
            Prop::ObjectFit => ValueKind::Enum(3),
            Prop::TranslateX => ValueKind::F32,
            Prop::TranslateY => ValueKind::F32,
            Prop::Scale => ValueKind::F32,
            Prop::Cursor => ValueKind::Enum(19),
            Prop::TextDecoration => ValueKind::Enum(3),
            Prop::LetterSpacing => ValueKind::F32,
            Prop::TextTransform => ValueKind::Enum(4),
            Prop::WhiteSpace => ValueKind::Enum(2),
            Prop::TextOverflow => ValueKind::Enum(2),
        }
    }

    /// Names of an enum property's values, by index.
    pub fn enum_names(self) -> &'static [&'static str] {
        match self {
            Prop::Display => &["flex", "none"],
            Prop::FlexDirection => &["row", "column", "rowReverse", "columnReverse"],
            Prop::FlexWrap => &["noWrap", "wrap"],
            Prop::JustifyContent => &[
                "start",
                "end",
                "center",
                "spaceBetween",
                "spaceAround",
                "spaceEvenly",
            ],
            Prop::AlignItems => &["stretch", "start", "end", "center", "baseline"],
            Prop::AlignSelf => &["auto", "stretch", "start", "end", "center", "baseline"],
            Prop::Position => &["relative", "absolute"],
            Prop::AlignContent => &[
                "stretch",
                "start",
                "end",
                "center",
                "spaceBetween",
                "spaceAround",
                "spaceEvenly",
            ],
            Prop::TextAlign => &["start", "center", "end"],
            Prop::FontStyle => &["normal", "italic"],
            Prop::Overflow => &["visible", "hidden", "scroll"],
            Prop::Scrollbar => &["auto", "none"],
            Prop::ObjectFit => &["fill", "contain", "cover"],
            Prop::Cursor => &[
                "auto",
                "default",
                "pointer",
                "text",
                "grab",
                "grabbing",
                "notAllowed",
                "move",
                "crosshair",
                "wait",
                "progress",
                "help",
                "ewResize",
                "nsResize",
                "neswResize",
                "nwseResize",
                "colResize",
                "rowResize",
                "none",
            ],
            Prop::TextDecoration => &["none", "underline", "lineThrough"],
            Prop::TextTransform => &["none", "uppercase", "lowercase", "capitalize"],
            Prop::WhiteSpace => &["normal", "nowrap"],
            Prop::TextOverflow => &["ellipsis", "clip"],
            _ => &[],
        }
    }
}
