"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layout = exports.escapeHtml = exports.ADMIN_EMAIL = exports.BRAND = void 0;
exports.BRAND = {
    name: 'Greenwich Training & Consulting',
    logoUrl: 'https://res.cloudinary.com/dp9urvlsz/image/upload/v1780840754/greenwich_logo_s9mgyc.png',
    primary: '#344e41',
    primaryDark: '#2a3f34',
    footerLink: '#a7c4b5',
    text: '#3f3f46',
    heading: '#1f2933',
    muted: '#71717a',
    bg: '#f4f5f7',
    card: '#ffffff',
    website: 'https://www.greenwichtc-elearning.com',
};
exports.ADMIN_EMAIL = 'greenwichtc@outlook.com';
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
exports.escapeHtml = escapeHtml;
function header() {
    if (exports.BRAND.logoUrl) {
        return `<img src="${escapeHtml(exports.BRAND.logoUrl)}" alt="${escapeHtml(exports.BRAND.name)}" width="140" style="display:block;margin:0 auto;border:0;" />`;
    }
    return `<div style="font-size:22px;font-weight:600;color:${exports.BRAND.primary};letter-spacing:0.5px;text-align:center;">${escapeHtml(exports.BRAND.name)}</div>`;
}
function ctaButton(ctaLabel, ctaUrl) {
    if (!ctaLabel || !ctaUrl)
        return '';
    const safeUrl = escapeHtml(ctaUrl);
    return `<table cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr>
              <td align="center" style="border-radius:8px;background:${exports.BRAND.primary};">
                <a href="${safeUrl}" class="button" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
          </table>`;
}
function layout(args) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap');
      body, table, td, a, p, span { font-family: 'Poppins', Arial, Helvetica, sans-serif; text-size-adjust: 100%; margin: 0; padding: 0; line-height: normal; }
      table { border-spacing: 0; width: 100%; }
      img { border: 0; display: block; }
      @media only screen and (max-width: 600px) {
        #container { width: 100% !important; }
        .footer-box { padding: 24px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background:${exports.BRAND.bg};">
    <table align="center" cellpadding="0" cellspacing="0" width="100%" style="background:${exports.BRAND.bg};padding:24px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" id="container" width="500" style="max-width:500px;background:${exports.BRAND.card};border-radius:16px;padding:32px;">
            <tr>
              <td>
                <!-- Hero -->
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="text-align:center;">${header()}</td></tr>
                </table>

                <!-- Content -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                  <tr>
                    <td>
                      <p style="font-size:18px;color:${exports.BRAND.heading};font-weight:600;">${escapeHtml(args.heading)}</p>
                      <div style="font-size:14px;color:${exports.BRAND.text};margin-top:12px;line-height:1.7;">
                        ${args.bodyHtml}
                      </div>
                      ${ctaButton(args.ctaLabel, args.ctaUrl)}
                    </td>
                  </tr>
                </table>

                <!-- Regards -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                  <tr><td><p style="font-size:14px;color:${exports.BRAND.text};">Kind regards,<br/>The ${escapeHtml(exports.BRAND.name)} Team</p></td></tr>
                </table>

                <!-- Footer -->
                <table width="100%" cellpadding="0" cellspacing="0" class="footer-box" style="background:${exports.BRAND.primary};border-radius:12px;margin-top:32px;padding:28px;">
                  <tr>
                    <td align="center">
                      <p style="font-size:12px;color:#ffffff;">This is an automated message from ${escapeHtml(exports.BRAND.name)}.</p>
                      <a href="${exports.BRAND.website}" style="font-size:12px;color:${exports.BRAND.footerLink};margin-top:8px;display:inline-block;text-decoration:none;">Visit your dashboard</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
exports.layout = layout;
//# sourceMappingURL=mail-layout.js.map