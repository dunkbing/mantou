//! Animations in the core (design §9.4): transitions (a property animates to
//! its new value when the app changes it) and explicit animations (ANIMATE),
//! on opacity, the transform (translateX, translateY, scale) and colours.
//! Values advance on the tree's clock (`tick`), which the window drives once
//! a frame while anything animates and a headless instance by its manual
//! clock, so no JS runs per frame. The scene draws the animated values; the
//! node's style keeps the target.

use super::{Node, Tree, TreeEvent, Visual};
use crate::protocol::{Prop, animate_flag, easing};

/// An animatable value: a number, or a colour as straight sRGB components 0–1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Val {
    F(f32),
    C([f32; 4]),
}

fn unpack(c: u32) -> [f32; 4] {
    [0, 8, 16, 24].map(|s| ((c >> s) & 255) as f32 / 255.0)
}

fn pack(c: [f32; 4]) -> u32 {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u32;
    b(c[0]) | b(c[1]) << 8 | b(c[2]) << 16 | b(c[3]) << 24
}

/// Whether a property can be animated.
pub(super) fn animatable(p: Prop) -> bool {
    matches!(p, Prop::Opacity | Prop::TranslateX | Prop::TranslateY | Prop::Scale | Prop::Rotate | Prop::Layout | Prop::BackgroundColor | Prop::BorderColor | Prop::Color)
}

/// Whether animating it moves boxes (so they're placed again), rather than only changing how they're drawn.
fn moves(p: Prop) -> bool {
    matches!(p, Prop::TranslateX | Prop::TranslateY | Prop::Scale | Prop::Rotate)
}

fn get(v: &Visual, p: Prop) -> Val {
    match p {
        Prop::Opacity => Val::F(v.opacity),
        Prop::TranslateX => Val::F(v.translate[0]),
        Prop::TranslateY => Val::F(v.translate[1]),
        Prop::Scale => Val::F(v.scale),
        Prop::Rotate => Val::F(v.rotate),
        Prop::BackgroundColor => Val::C(unpack(v.background)),
        Prop::BorderColor => Val::C(unpack(v.border_color)),
        _ => Val::C(unpack(v.color)),
    }
}

fn set(v: &mut Visual, p: Prop, val: Val) {
    match (p, val) {
        (Prop::Opacity, Val::F(f)) => v.opacity = f.clamp(0.0, 1.0),
        (Prop::TranslateX, Val::F(f)) => v.translate[0] = f,
        (Prop::TranslateY, Val::F(f)) => v.translate[1] = f,
        (Prop::Scale, Val::F(f)) => v.scale = f.max(0.0),
        (Prop::Rotate, Val::F(f)) => v.rotate = f,
        (Prop::BackgroundColor, Val::C(c)) => v.background = pack(c),
        (Prop::BorderColor, Val::C(c)) => v.border_color = pack(c),
        (Prop::Color, Val::C(c)) => v.color = pack(c),
        _ => {}
    }
}

/// A value from ANIMATE's words: an f32's bits for numbers (not finite: 0), RGBA8 for colours.
fn from_word(p: Prop, w: u32) -> Val {
    if matches!(p, Prop::BackgroundColor | Prop::BorderColor | Prop::Color) {
        Val::C(unpack(w))
    } else {
        let f = f32::from_bits(w);
        Val::F(if f.is_finite() { f } else { 0.0 })
    }
}

fn lerp(a: Val, b: Val, t: f32) -> Val {
    match (a, b) {
        (Val::F(x), Val::F(y)) => Val::F(x + (y - x) * t),
        (Val::C(x), Val::C(y)) => Val::C([0, 1, 2, 3].map(|i| x[i] + (y[i] - x[i]) * t)),
        _ => b,
    }
}

/// A CSS cubic-bezier(x1, y1, x2, y2) at progress x.
fn bezier(x1: f32, y1: f32, x2: f32, y2: f32, x: f32) -> f32 {
    let curve = |a: f32, b: f32, t: f32| 3.0 * a * t * (1.0 - t) * (1.0 - t) + 3.0 * b * t * t * (1.0 - t) + t * t * t;
    // Solve curve_x(t) = x by bisection (monotonic for these curves), then return curve_y(t).
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if curve(x1, x2, mid) < x { lo = mid } else { hi = mid }
    }
    curve(y1, y2, (lo + hi) / 2.0)
}

/// A spring that settles by t = 1: `damping` is its ratio in hundredths (1.00 = critical); under 1 it overshoots.
fn spring(ratio: f32, t: f32) -> f32 {
    if t >= 1.0 {
        return 1.0;
    }
    if ratio < 1.0 {
        let w = 6.0 / ratio; // normalised natural frequency: the envelope is 0.25% by t = 1
        let wd = w * (1.0 - ratio * ratio).sqrt();
        1.0 - (-ratio * w * t).exp() * ((wd * t).cos() + ratio * w / wd * (wd * t).sin())
    } else {
        let w = 8.0;
        1.0 - (1.0 + w * t) * (-w * t).exp()
    }
}

fn ease(kind: u32, t: f32) -> f32 {
    if kind >= easing::SPRING {
        return spring(((kind - easing::SPRING) as f32 / 100.0).clamp(0.05, 1.0), t.max(0.0));
    }
    let t = t.clamp(0.0, 1.0);
    match kind {
        easing::EASE => bezier(0.25, 0.1, 0.25, 1.0, t),
        easing::EASE_IN => bezier(0.42, 0.0, 1.0, 1.0, t),
        easing::EASE_OUT => bezier(0.0, 0.0, 0.58, 1.0, t),
        easing::EASE_IN_OUT => bezier(0.42, 0.0, 0.58, 1.0, t),
        _ => t,
    }
}

#[derive(Clone, Debug)]
struct Active {
    prop: Prop,
    from: Val,
    to: Val,
    /// Start (ms on the tree's clock) and duration.
    start: f64,
    duration: f64,
    easing: u32,
    /// For ANIMATE: its id, how many times, and back and forth. A transition has id 0 and runs once.
    id: u32,
    iterations: f64,
    alternate: bool,
    /// Keyframes (KEYFRAMES): evenly spaced values over one iteration, instead of from and to.
    steps: Vec<Val>,
    current: Val,
}

#[derive(Default)]
pub(super) struct Anims {
    /// TRANSITIONs: duration (ms) and easing per property.
    transitions: Vec<(Prop, f32, u32)>,
    active: Vec<Active>,
}

impl Anims {
    /// Draws the animated values over the node's style.
    pub(super) fn apply(&self, v: &mut Visual) {
        for a in &self.active {
            set(v, a.prop, a.current);
        }
    }

    pub(super) fn is_active(&self) -> bool {
        !self.active.is_empty()
    }
}

impl Node {
    /// The node's look as drawn now: its style, with animated values over it.
    pub(super) fn vis(&self) -> Visual {
        let mut v = self.v;
        if let Some(a) = &self.anim {
            a.apply(&mut v);
        }
        v
    }
}

impl Tree {
    /// The time on the tree's clock (ms), set before each batch and tick.
    pub fn set_time(&mut self, now_ms: f64) {
        self.now = now_ms;
    }

    /// Whether anything is animating (the window then draws every frame).
    pub fn is_animating(&self) -> bool {
        self.animating > 0
    }

    pub(super) fn set_transition(&mut self, id: u32, prop: Prop, duration: f32, easing: u32) -> Result<(), String> {
        if !animatable(prop) {
            return Err(format!("TRANSITION: {} can't be animated", prop.name()));
        }
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let anims = node.anim.get_or_insert_with(Box::default);
        anims.transitions.retain(|(p, ..)| *p != prop);
        if duration > 0.0 {
            anims.transitions.push((prop, duration, easing));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn start_animation(&mut self, id: u32, animation: u32, prop: Prop, from: u32, to: u32, duration: f32, easing: u32, iterations: f32, flags: u32) -> Result<(), String> {
        if !animatable(prop) {
            return Err(format!("ANIMATE: {} can't be animated", prop.name()));
        }
        let now = self.now;
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let anims = node.anim.get_or_insert_with(Box::default);
        // A new animation of the same property replaces the old one, which ends.
        let mut ended = Vec::new();
        anims.active.retain(|a| {
            if a.prop == prop {
                if a.id != 0 {
                    ended.push(a.id);
                }
                false
            } else {
                true
            }
        });
        let (from, to) = (from_word(prop, from), from_word(prop, to));
        anims.active.push(Active {
            prop,
            from,
            to,
            start: now,
            duration: duration.max(0.0) as f64,
            easing,
            id: animation,
            iterations: if iterations.is_nan() { 1.0 } else { iterations as f64 },
            alternate: flags & animate_flag::ALTERNATE != 0,
            steps: Vec::new(),
            current: from,
        });
        for a in ended {
            self.events.push(TreeEvent::AnimationEnd { id, animation: a });
        }
        self.after_anim_change(moves(prop));
        Ok(())
    }

    pub(super) fn set_keyframes(&mut self, id: u32, animation: u32, values: Vec<u32>) -> Result<(), String> {
        let node = self.nodes.get_mut(&id).ok_or_else(|| format!("no node {id}"))?;
        let Some(act) = node.anim.as_mut().and_then(|a| a.active.iter_mut().find(|a| a.id == animation && animation != 0)) else {
            return Err(format!("KEYFRAMES: node {id} has no running animation {animation}"));
        };
        let steps: Vec<Val> = values.iter().map(|&w| from_word(act.prop, w)).collect();
        act.from = steps[0];
        act.to = *steps.last().expect("two or more values");
        act.current = act.from;
        act.steps = steps;
        Ok(())
    }

    /// After a restyle: properties with a transition whose target changed
    /// animate from what's drawn now. Not on a node's first look (it was never drawn).
    pub(super) fn start_transitions(&mut self, id: u32, before: Visual, drawn_before: Visual) {
        let now = self.now;
        let Some(node) = self.nodes.get_mut(&id) else { return };
        if !node.placed {
            return;
        }
        let after = node.v;
        let Some(anims) = node.anim.as_mut() else { return };
        let mut moved = false;
        let mut started = false;
        for &(prop, duration, easing) in &anims.transitions {
            let (old, new) = (get(&before, prop), get(&after, prop));
            if old == new {
                continue;
            }
            anims.active.retain(|a| a.prop != prop || a.id != 0);
            let from = get(&drawn_before, prop);
            anims.active.push(Active { prop, from, to: new, start: now, duration: duration as f64, easing, id: 0, iterations: 1.0, alternate: false, steps: Vec::new(), current: from });
            moved |= moves(prop);
            started = true;
        }
        if started {
            self.after_anim_change(moved);
        }
    }

    /// After a layout: nodes with a `layout` transition that landed somewhere else (relative to their parent)
    /// slide there, from where they were drawn, as a translation that ends at the style's own.
    pub(super) fn animate_layout(&mut self) {
        let now = self.now;
        let ids: Vec<u32> = self.nodes.iter().filter(|(_, n)| n.anim.as_ref().is_some_and(|a| a.transitions.iter().any(|t| t.0 == Prop::Layout))).map(|(id, _)| *id).collect();
        let mut started = false;
        for id in ids {
            let Some(taffy_id) = self.nodes.get(&id).map(|n| n.taffy) else { continue };
            let Ok(l) = self.taffy.layout(taffy_id) else { continue };
            let loc = [l.location.x, l.location.y];
            let node = self.nodes.get_mut(&id).expect("exists");
            let Some(prev) = node.last_loc.replace(loc) else { continue };
            let drawn = node.vis().translate;
            let style = node.v.translate;
            let Some(&(_, duration, easing)) = node.anim.as_ref().and_then(|a| a.transitions.iter().find(|t| t.0 == Prop::Layout)) else { continue };
            let anims = node.anim.as_mut().expect("has transitions");
            for (i, prop) in [Prop::TranslateX, Prop::TranslateY].into_iter().enumerate() {
                let d = prev[i] - loc[i];
                if d.abs() < 0.5 {
                    continue;
                }
                // It was drawn at its old place plus the translation then running; it ends at the style's.
                let from = d + drawn[i];
                anims.active.retain(|a| a.prop != prop || a.id != 0);
                if anims.active.iter().any(|a| a.prop == prop) {
                    continue; // an explicit animation of it keeps control
                }
                anims.active.push(Active { prop, from: Val::F(from), to: Val::F(style[i]), start: now, duration: duration as f64, easing, id: 0, iterations: 1.0, alternate: false, steps: Vec::new(), current: Val::F(from) });
                started = true;
            }
        }
        if started {
            self.after_anim_change(true);
        }
    }

    fn after_anim_change(&mut self, moved: bool) {
        self.animating = self.nodes.values().filter(|n| n.anim.as_ref().is_some_and(|a| a.is_active())).count();
        self.scene_dirty = true;
        if moved {
            self.boxes_dirty = true;
        }
    }

    /// Advances animations to the tree's clock; finished ones end (ANIMATION_END
    /// for explicit ones). Returns whether anything is still animating.
    pub fn tick(&mut self) -> bool {
        if self.animating == 0 {
            return false;
        }
        let now = self.now;
        let mut moved = false;
        let mut ended = Vec::new();
        for (&id, node) in self.nodes.iter_mut() {
            let Some(anims) = node.anim.as_mut() else { continue };
            if anims.active.is_empty() {
                continue;
            }
            anims.active.retain_mut(|a| {
                moved |= moves(a.prop);
                let cycles = if a.duration > 0.0 { ((now - a.start) / a.duration).max(0.0) } else { f64::INFINITY };
                if cycles >= a.iterations {
                    if a.id != 0 {
                        ended.push((id, a.id));
                    }
                    return false; // done: back to the style's value (a transition's target is the style)
                }
                let (n, f) = (cycles.floor(), cycles.fract() as f32);
                let f = if a.alternate && (n as u64) % 2 == 1 { 1.0 - f } else { f };
                a.current = if a.steps.len() > 2 {
                    // Evenly spaced steps; the easing shapes each one.
                    let x = f * (a.steps.len() - 1) as f32;
                    let i = (x.floor() as usize).min(a.steps.len() - 2);
                    lerp(a.steps[i], a.steps[i + 1], ease(a.easing, x - i as f32))
                } else {
                    lerp(a.from, a.to, ease(a.easing, f))
                };
                true
            });
        }
        for (id, animation) in ended {
            self.events.push(TreeEvent::AnimationEnd { id, animation });
        }
        self.after_anim_change(moved);
        self.animating > 0
    }
}
