//! Mantou's shadow tree: decodes the Worker's op batches, keeps the node tree,
//! lays it out with Taffy, builds the scene the renderer draws and hit-tests
//! input. It has no platform or GPU dependencies, so it is tested headless
//! (design §6.2, §12.4).

pub mod decode;
pub mod encode;
pub mod protocol;
pub mod tree;

pub use decode::{DecodeError, Length, Op, Value, decode};
pub use encode::Ops;
pub use tree::{ApplyReport, Extra, ImageRef, Pixels, WindowLimits, Clipboard, TreeEvent, MemoryClipboard, Quad, Scene, Tree, TreeStats};
