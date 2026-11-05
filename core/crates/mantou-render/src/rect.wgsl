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
    @location(7) radii: vec4<f32>,        // top left, top right, bottom right, bottom left corner radius (pixels)
    @location(8) widths: vec4<f32>,       // top, right, bottom, left border width (pixels)
    @location(9) color2: vec4<f32>,       // the gradient's end colour: linear RGB, straight alpha
    @location(10) grad: vec4<f32>,        // gradient angle (radians, CSS: 0 up, clockwise), 1 = a gradient
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
    @location(7) @interpolate(flat) radii: vec4<f32>,
    @location(8) @interpolate(flat) widths: vec4<f32>,
    @location(9) @interpolate(flat) color2: vec4<f32>,
    @location(10) @interpolate(flat) grad: vec4<f32>,
    @location(11) @interpolate(flat) uvr: vec4<f32>,
};

@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var image_sampler: sampler;

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
    out.glyph = select(0u, 1u, inst.uv.z > inst.uv.x && inst.params.w < 1.5);
    out.rect_px = inst.rect_px;
    out.border_color = inst.border_color;
    out.params = inst.params;
    out.radii = inst.radii;
    out.widths = inst.widths;
    out.color2 = inst.color2;
    out.grad = inst.grad;
    out.uvr = inst.uv;
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

// Like rounded_box, with a radius for each corner (top left, top right, bottom right, bottom left).
fn rounded_box4(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>, radii: vec4<f32>) -> f32 {
    let center = (lo + hi) * 0.5;
    let half = (hi - lo) * 0.5;
    let right = p.x > center.x;
    let below = p.y > center.y;
    var radius = select(radii.x, radii.y, right);
    if (below) {
        radius = select(radii.w, radii.z, right);
    }
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
    var p = in.position.xy;
    if (p.x < in.clip.x || p.y < in.clip.y || p.x >= in.clip.z || p.y >= in.clip.w) {
        discard;
    }
    if (in.grad.z != 0.0) {
        // A turned rectangle: look at the pixel in the rectangle's own frame.
        let c = (in.rect_px.xy + in.rect_px.zw) * 0.5;
        let d = p - c;
        let sn = sin(in.grad.z);
        let cs = cos(in.grad.z);
        p = c + vec2<f32>(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);
    }
    var uv = in.uv;
    var turned = false;
    if (in.grad.z != 0.0 && in.uvr.z > in.uvr.x) {
        // A turned glyph or image: its texels come from where the pixel is in the quad's own frame.
        let t = (p - in.rect_px.xy) / max(in.rect_px.zw - in.rect_px.xy, vec2<f32>(0.0001));
        if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) {
            discard;
        }
        uv = mix(in.uvr.xy, in.uvr.zw, t);
        turned = true;
    }
    if (in.glyph == 1u) {
        var cover: f32;
        if (turned) {
            // Smoothed between texels, kept inside this glyph's own rectangle.
            let q = clamp(uv, in.uvr.xy + vec2<f32>(0.5), in.uvr.zw - vec2<f32>(0.5)) - vec2<f32>(0.5);
            let base = vec2<i32>(floor(q));
            let f = q - floor(q);
            let a00 = textureLoad(atlas, base, 0).r;
            let a10 = textureLoad(atlas, base + vec2<i32>(1, 0), 0).r;
            let a01 = textureLoad(atlas, base + vec2<i32>(0, 1), 0).r;
            let a11 = textureLoad(atlas, base + vec2<i32>(1, 1), 0).r;
            cover = mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
        } else {
            cover = textureLoad(atlas, vec2<i32>(floor(uv)), 0).r;
        }
        let a = in.color.a * cover;
        return vec4<f32>(in.color.rgb * a, a);
    }
    let radius = in.params.x;
    let border = in.params.y;
    if (in.params.w > 3.5) {
        // One pixel row of a filled shape: four sub-rows, each with exact horizontal coverage between the edges
        // (radii: left edge at the row's top and bottom, right edge at its top and bottom).
        if (p.y < in.rect_px.y || p.y >= in.rect_px.w) {
            discard; // its own row only: the quad is a pixel wider all round for the smoothing, not for painting rows
        }
        var cover = 0.0;
        for (var k = 0; k < 4; k++) {
            let t = (f32(k) + 0.5) / 4.0;
            let xl = mix(in.radii.x, in.radii.y, t);
            let xr = mix(in.radii.z, in.radii.w, t);
            cover += clamp(min(xr, p.x + 0.5) - max(xl, p.x - 0.5), 0.0, 1.0);
        }
        let a = in.color.a * cover * 0.25;
        return vec4<f32>(in.color.rgb * a, a);
    }
    if (in.params.w > 2.5) {
        // A strip between a slanted top edge (heights radii.x at the left side, radii.y at the right) and the
        // horizontal line radii.z. Its sides are on whole pixels, so neighbours meet without a seam; only the
        // slanted edge and the horizontal one are smoothed.
        if (p.x < in.rect_px.x || p.x >= in.rect_px.z) {
            discard; // exactly its own columns: translucent neighbours must not overlap
        }
        let w = max(in.rect_px.z - in.rect_px.x, 0.0001);
        let t = clamp((p.x - in.rect_px.x) / w, 0.0, 1.0);
        let ty = mix(in.radii.x, in.radii.y, t);
        let slope = (in.radii.y - in.radii.x) / w;
        let dir = select(-1.0, 1.0, in.radii.z >= (in.radii.x + in.radii.y) * 0.5);
        let across = clamp(0.5 + dir * (p.y - ty) / sqrt(1.0 + slope * slope), 0.0, 1.0);
        let along = clamp(0.5 + dir * (in.radii.z - p.y), 0.0, 1.0);
        let a = in.color.a * min(across, along);
        return vec4<f32>(in.color.rgb * a, a);
    }
    if (in.params.w > 1.5) {
        // An image: its texels (uv, in pixels of the image) sampled with
        // filtering, cut to the quad's rounded corners; tinted, it's drawn as
        // its alpha in the quad's colour.
        let dims = vec2<f32>(textureDimensions(image));
        let tex = textureSampleLevel(image, image_sampler, uv / dims, 0.0);
        var mask = 1.0;
        if (radius > 0.0) {
            mask = clamp(0.5 - rounded_box(p, in.rect_px.xy, in.rect_px.zw, radius), 0.0, 1.0);
        }
        let a = tex.a * in.color.a * mask;
        let rgb = select(tex.rgb, in.color.rgb, in.params.z > 0.5);
        return vec4<f32>(rgb * a, a);
    }
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
    // The fill colour: flat, or a linear gradient along the angle across the box.
    var color = in.color;
    if (in.grad.y > 0.5) {
        let dir = vec2<f32>(sin(in.grad.x), -cos(in.grad.x));
        let half = (in.rect_px.zw - in.rect_px.xy) * 0.5;
        let reach = max(abs(half.x * dir.x) + abs(half.y * dir.y), 0.0001);
        let t = clamp(dot(p - (in.rect_px.xy + half), dir) / reach * 0.5 + 0.5, 0.0, 1.0);
        color = mix(in.color, in.color2, t);
    }
    let own = in.radii.x != in.radii.y || in.radii.y != in.radii.z || in.radii.z != in.radii.w
        || in.widths.x != in.widths.y || in.widths.y != in.widths.z || in.widths.z != in.widths.w;
    let widest = max(max(in.widths.x, in.widths.y), max(in.widths.z, in.widths.w));
    if (!own && radius <= 0.0 && border <= 0.0 && in.grad.z == 0.0) {
        return vec4<f32>(color.rgb * color.a, color.a);
    }
    let d = rounded_box4(p, in.rect_px.xy, in.rect_px.zw, in.radii);
    let outer = clamp(0.5 - d, 0.0, 1.0);
    // The border is a ring inside the edge, as wide as each side says; the fill is what's left.
    var inner = outer;
    if (widest > 0.0) {
        let lo = in.rect_px.xy + vec2<f32>(in.widths.w, in.widths.x);
        let hi = in.rect_px.zw - vec2<f32>(in.widths.y, in.widths.z);
        let shrink = vec4<f32>(max(in.widths.x, in.widths.w), max(in.widths.x, in.widths.y), max(in.widths.z, in.widths.y), max(in.widths.z, in.widths.w));
        inner = clamp(0.5 - rounded_box4(p, lo, hi, max(in.radii - shrink, vec4<f32>(0.0))), 0.0, 1.0) * select(0.0, 1.0, hi.x > lo.x && hi.y > lo.y);
    }
    let fill = color.a * inner;
    let ring = in.border_color.a * (outer - inner);
    let a = fill + ring;
    return vec4<f32>(color.rgb * fill + in.border_color.rgb * ring, a);
}
