// One instance per quad: a filled (optionally rounded, optionally bordered)
// rectangle, or a glyph whose coverage comes from the atlas. Positions arrive
// in normalised device coordinates, everything the fragment shader measures in
// pixels; colours are linear and premultiplied at the end.

struct Instance {
    @location(0) rect: vec4<f32>,         // x0, y0, x1, y1 in NDC
    @location(1) color: vec4<f32>,        // fill: linear RGB, straight alpha
    @location(2) uv: vec4<f32>,           // atlas texels x0, y0, x1, y1; all zero for a rectangle
    @location(3) clip: vec4<f32>,         // pixels x0, y0, x1, y1
    @location(4) rect_px: vec4<f32>,      // the quad in pixels
    @location(5) border_color: vec4<f32>, // linear RGB, straight alpha
    @location(6) params: vec4<f32>,       // corner radius, border width, shadow sigma (pixels), 1 = a shadow
};

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) @interpolate(flat) clip: vec4<f32>,
    @location(3) @interpolate(flat) glyph: u32,
    @location(4) @interpolate(flat) rect_px: vec4<f32>,
    @location(5) @interpolate(flat) border_color: vec4<f32>,
    @location(6) @interpolate(flat) params: vec4<f32>,
};

@group(0) @binding(0) var atlas: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32, inst: Instance) -> VsOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    );
    let c = corners[vi];
    var out: VsOut;
    out.position = vec4<f32>(mix(inst.rect.xy, inst.rect.zw, c), 0.0, 1.0);
    out.color = inst.color;
    out.uv = mix(inst.uv.xy, inst.uv.zw, c);
    out.clip = inst.clip;
    out.glyph = select(0u, 1u, inst.uv.z > inst.uv.x);
    out.rect_px = inst.rect_px;
    out.border_color = inst.border_color;
    out.params = inst.params;
    return out;
}

// Signed distance from p to a rounded box (negative inside).
fn rounded_box(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>, radius: f32) -> f32 {
    let center = (lo + hi) * 0.5;
    let half = (hi - lo) * 0.5;
    let r = min(radius, min(half.x, half.y));
    let q = abs(p - center) - half + vec2<f32>(r, r);
    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// erf, to within about 5e-4 (Abramowitz and Stegun 7.1.26).
fn erf(x: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * abs(x));
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
    return sign(x) * y;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let p = in.position.xy;
    if (p.x < in.clip.x || p.y < in.clip.y || p.x >= in.clip.z || p.y >= in.clip.w) {
        discard;
    }
    if (in.glyph == 1u) {
        let a = in.color.a * textureLoad(atlas, vec2<i32>(floor(in.uv)), 0).r;
        return vec4<f32>(in.color.rgb * a, a);
    }
    let radius = in.params.x;
    let border = in.params.y;
    if (in.params.w > 0.5) {
        // A box shadow: the rounded box's coverage, blurred. Convolving the
        // distance with a Gaussian gives the classic erf falloff; a sharp
        // shadow (sigma 0) is just the anti-aliased box.
        let d = rounded_box(p, in.rect_px.xy, in.rect_px.zw, radius);
        let sigma = in.params.z;
        var cover = clamp(0.5 - d, 0.0, 1.0);
        if (sigma > 0.0) {
            cover = 0.5 - 0.5 * erf(d / (sigma * 1.41421356));
        }
        let a = in.color.a * cover;
        return vec4<f32>(in.color.rgb * a, a);
    }
    if (radius <= 0.0 && border <= 0.0) {
        return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
    }
    let d = rounded_box(p, in.rect_px.xy, in.rect_px.zw, radius);
    let outer = clamp(0.5 - d, 0.0, 1.0);
    // The border is a ring `border` px wide inside the edge; the fill is what's left.
    let inner = select(outer, clamp(0.5 - (d + border), 0.0, 1.0), border > 0.0);
    let fill = in.color.a * inner;
    let ring = in.border_color.a * (outer - inner);
    let a = fill + ring;
    return vec4<f32>(in.color.rgb * fill + in.border_color.rgb * ring, a);
}
