/**
 * Shared email branding + responsive HTML shell used by all Greenwich emails
 * (engagement reminders, password reset, …). Table-based with inline styles and
 * an Arial fallback so it renders reliably across email clients.
 *
 * Edit BRAND to restyle/rebrand every email at once.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * `logoUrl`: a PUBLIC, absolute URL (email clients cannot load local/relative
 * images). Set to an empty string to fall back to a styled text wordmark.
 */
export const BRAND = {
  name: 'Greenwich Training & Consulting',
  logoUrl:
    'https://res.cloudinary.com/dp9urvlsz/image/upload/v1780840754/greenwich_logo_s9mgyc.png',
  primary: '#344e41', // app theme green
  primaryDark: '#2a3f34',
  footerLink: '#a7c4b5', // light green, readable on the dark-green footer
  text: '#3f3f46',
  heading: '#1f2933',
  muted: '#71717a',
  bg: '#f4f5f7',
  card: '#ffffff',
  website: 'https://www.greenwichtc-elearning.com',
} as const;

/**
 * Single admin recipient for admin-facing emails (contact messages, new
 * feedback submissions, etc.). Centralised so there's one place to change it.
 * Not derived from DB admin users — the business wants one fixed inbox.
 */
export const ADMIN_EMAIL = 'greenwichtc@outlook.com';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header block: logo image when BRAND.logoUrl is set, otherwise a styled wordmark. */
function header(): string {
  if (BRAND.logoUrl) {
    return `<img src="${escapeHtml(BRAND.logoUrl)}" alt="${escapeHtml(
      BRAND.name,
    )}" width="140" style="display:block;margin:0 auto;border:0;" />`;
  }
  return `<div style="font-size:22px;font-weight:600;color:${BRAND.primary
    };letter-spacing:0.5px;text-align:center;">${escapeHtml(BRAND.name)}</div>`;
}

/** Optional CTA button block (omitted when no ctaUrl is given). */
function ctaButton(ctaLabel?: string, ctaUrl?: string): string {
  if (!ctaLabel || !ctaUrl) return '';
  const safeUrl = escapeHtml(ctaUrl);
  return `<table cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr>
              <td align="center" style="border-radius:8px;background:${BRAND.primary
    };">
                <a href="${safeUrl}" class="button" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(
      ctaLabel,
    )}</a>
              </td>
            </tr>
          </table>`;
}

/**
 * Full responsive HTML shell. `bodyHtml` is the message-specific content
 * (the caller is responsible for HTML-escaping any user data it embeds).
 * `ctaLabel`/`ctaUrl` are optional — omit for emails with no button.
 */
export function layout(args: {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
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
  <body style="margin:0;padding:0;width:100%;background:${BRAND.bg};">
    <table align="center" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.bg
    };padding:24px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" id="container" width="500" style="max-width:500px;background:${BRAND.card
    };border-radius:16px;padding:32px;">
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
                      <p style="font-size:18px;color:${BRAND.heading
    };font-weight:600;">${escapeHtml(args.heading)}</p>
                      <div style="font-size:14px;color:${BRAND.text
    };margin-top:12px;line-height:1.7;">
                        ${args.bodyHtml}
                      </div>
                      ${ctaButton(args.ctaLabel, args.ctaUrl)}
                    </td>
                  </tr>
                </table>

                <!-- Regards -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                  <tr><td><p style="font-size:14px;color:${BRAND.text
    };">Kind regards,<br/>The ${escapeHtml(
      BRAND.name,
    )} Team</p></td></tr>
                </table>

                <!-- Footer -->
                <table width="100%" cellpadding="0" cellspacing="0" class="footer-box" style="background:${BRAND.primary
    };border-radius:12px;margin-top:32px;padding:28px;">
                  <tr>
                    <td align="center">
                      <p style="font-size:12px;color:#ffffff;">This is an automated message from ${escapeHtml(
      BRAND.name,
    )}.</p>
                      <a href="${BRAND.website}" style="font-size:12px;color:${BRAND.footerLink
    };margin-top:8px;display:inline-block;text-decoration:none;">Visit your dashboard</a>
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
