"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEngagementReminder = void 0;
const mail_types_1 = require("../mail.types");
const BRAND = {
    name: 'Greenwich Training Centre',
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
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function header() {
    if (BRAND.logoUrl) {
        return `<img src="${escapeHtml(BRAND.logoUrl)}" alt="${escapeHtml(BRAND.name)}" width="140" style="display:block;margin:0 auto;border:0;" />`;
    }
    return `<div style="font-size:22px;font-weight:600;color:${BRAND.primary};letter-spacing:0.5px;text-align:center;">${escapeHtml(BRAND.name)}</div>`;
}
function layout(args) {
    const safeUrl = escapeHtml(args.ctaUrl);
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
    <table align="center" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.bg};padding:24px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" id="container" width="500" style="max-width:500px;background:${BRAND.card};border-radius:16px;padding:32px;">
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
                      <p style="font-size:18px;color:${BRAND.heading};font-weight:600;">${escapeHtml(args.heading)}</p>
                      <div style="font-size:14px;color:${BRAND.text};margin-top:12px;line-height:1.7;">
                        ${args.bodyHtml}
                      </div>

                      <!-- CTA button -->
                      <table cellpadding="0" cellspacing="0" style="margin-top:28px;">
                        <tr>
                          <td align="center" style="border-radius:8px;background:${BRAND.primary};">
                            <a href="${safeUrl}" class="button" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(args.ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Regards -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                  <tr><td><p style="font-size:14px;color:${BRAND.text};">Kind regards,<br/>The ${escapeHtml(BRAND.name)} Team</p></td></tr>
                </table>

                <!-- Footer -->
                <table width="100%" cellpadding="0" cellspacing="0" class="footer-box" style="background:${BRAND.primary};border-radius:12px;margin-top:32px;padding:28px;">
                  <tr>
                    <td align="center">
                      <p style="font-size:12px;color:#ffffff;">This is an automated message from ${escapeHtml(BRAND.name)}.</p>
                      <a href="${BRAND.website}" style="font-size:12px;color:${BRAND.footerLink};margin-top:8px;display:inline-block;text-decoration:none;">Visit your dashboard</a>
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
function progressLine(mail) {
    const done = mail.completedSections ?? 0;
    const total = mail.totalSections ?? 0;
    if (total <= 0 || done <= 0)
        return null;
    const safeDone = Math.min(done, total);
    const pct = Math.round((safeDone / total) * 100);
    const sentence = `You've already completed ${safeDone} of ${total} lessons (${pct}%) — you're well on your way.`;
    return {
        html: `<p style="margin-top:12px;">${escapeHtml(sentence)}</p>`,
        text: sentence,
    };
}
function variantFor(mail) {
    const firstName = escapeHtml(mail.firstName || 'there');
    const courseTitle = escapeHtml(mail.courseTitle);
    if (mail.reminderType === mail_types_1.ReminderType.NEVER_STARTED) {
        const duration = (mail.courseDuration || '').trim();
        const durationHtml = duration
            ? `<p style="margin-top:12px;">This course is designed to be completed in around <strong>${escapeHtml(duration)}</strong> — starting now keeps you comfortably on track.</p>`
            : '';
        const durationText = duration
            ? `\n\nThis course is designed to be completed in around ${duration} — starting now keeps you comfortably on track.`
            : '';
        return {
            subject: `Your enrolment in ${mail.courseTitle} — getting started`,
            heading: 'Ready to begin your course?',
            intro: `<p>Dear ${firstName},</p>
              <p style="margin-top:12px;">Our records show that you enrolled in <strong>${courseTitle}</strong> but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.</p>
              ${durationHtml}`,
            ctaLabel: 'Begin course',
            textBody: `Dear ${mail.firstName || 'there'},

Our records show that you enrolled in ${mail.courseTitle} but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.${durationText}`,
        };
    }
    const progress = progressLine(mail);
    const progressHtml = progress ? progress.html : '';
    const progressText = progress ? `\n\n${progress.text}` : '';
    return {
        subject: `Continuing your ${mail.courseTitle} course`,
        heading: 'Pick up where you left off',
        intro: `<p>Dear ${firstName},</p>
            <p style="margin-top:12px;">We noticed it has been some time since your last activity in <strong>${courseTitle}</strong>. Your progress has been saved, and you may resume from where you left off at any time.</p>
            ${progressHtml}`,
        ctaLabel: 'Resume course',
        textBody: `Dear ${mail.firstName || 'there'},

We noticed it has been some time since your last activity in ${mail.courseTitle}. Your progress has been saved, and you may resume from where you left off at any time.${progressText}`,
    };
}
function renderEngagementReminder(mail) {
    const v = variantFor(mail);
    const html = layout({
        heading: v.heading,
        bodyHtml: v.intro,
        ctaLabel: v.ctaLabel,
        ctaUrl: mail.courseUrl,
    });
    const text = `${v.textBody}

${v.ctaLabel}: ${mail.courseUrl}

Kind regards,
The ${BRAND.name} Team`;
    return { subject: v.subject, html, text };
}
exports.renderEngagementReminder = renderEngagementReminder;
//# sourceMappingURL=engagement-reminder.template.js.map