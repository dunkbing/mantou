// A sample HTML mail: table layout and inline CSS, as mail clients send it, with an inline (cid:) logo,
// a remote image (blocked until the reader allows it) and a tracking pixel.
export const LOGO = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><path d="M9 21V11l7 6 7-6v10" stroke="#fff" stroke-width="2.5" fill="none" stroke-linejoin="round"/></svg>`,
);

export const MESSAGE = `<!DOCTYPE html>
<html><head><style>
  .btn { background:#1f883d; color:#ffffff; padding:8px 16px; border-radius:6px; text-decoration:none; font-weight:600; display:inline-block }
  @media (prefers-color-scheme: dark) { .page { background:#0d1117 } .card { background:#161b22; border-color:#30363d } .ink { color:#e6edf3 } .muted { color:#8b949e } }
</style></head>
<body style="margin:0">
<table class="page" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f8fa" style="font-family:Inter,Helvetica,Arial,sans-serif"><tr><td align="center" style="padding:24px 12px">
  <table class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:544px;background:#ffffff;border:1px solid #d0d7de;border-radius:6px">
    <tr><td style="padding:16px 24px;border-bottom:1px solid #d0d7de">
      <img src="cid:logo@mantou" width="32" height="32" alt="" style="vertical-align:middle">
      <span class="muted" style="font-size:14px;color:#57606a;vertical-align:middle;margin-left:8px">dunkbing/mantou</span>
    </td></tr>
    <tr><td style="padding:24px">
      <h2 class="ink" style="margin:0 0 8px 0;font-size:20px;color:#1f2328">Html: render a static HTML/CSS document natively <span class="muted" style="color:#57606a;font-weight:400">#74</span></h2>
      <p class="ink" style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#1f2328"><b>dunkbing</b> commented on this issue.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #d0d7de"><tr><td class="muted" style="padding:4px 12px;font-size:14px;color:#57606a;line-height:1.5">
        This mail is drawn by Mantou's core: Blitz lays it out, it scrolls and clips like any other node, and no script runs. Remote images wait until you allow them.
      </td></tr></table>
      <p style="margin:16px 0"><img src="https://picsum.photos/id/1015/496/160" width="496" height="160" alt="A remote image" style="display:block;width:100%;height:auto;border-radius:6px;background:#eaeef2"></p>
      <p style="margin:24px 0"><a class="btn" href="https://github.com/dunkbing/mantou/issues/74">View it on GitHub</a></p>
      <p class="muted" style="margin:0;font-size:12px;color:#57606a">You are receiving this because you were mentioned. <a href="https://github.com/settings/notifications" style="color:#0969da">Unsubscribe</a></p>
    </td></tr>
  </table>
</td></tr></table>
<img src="https://example.com/beacon.gif" width="1" height="1" alt="">
</body></html>`;
