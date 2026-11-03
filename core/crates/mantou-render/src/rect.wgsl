// One instance per rectangle. Positions arrive in normalised device
// coordinates; colours are linear and premultiplied when they reach the blend.

struct Instance {
    @location(0) rect: vec4<f32>,  // x0, y0, x1, y1 in NDC
    @location(1) color: vec4<f32>, // linear RGB, straight alpha
};

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

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
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
}
