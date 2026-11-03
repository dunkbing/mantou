//! Any bytes: the decoder returns ops or an error, never panics or aborts.
#![no_main]
libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    let _ = mantou_tree::decode(data);
});
