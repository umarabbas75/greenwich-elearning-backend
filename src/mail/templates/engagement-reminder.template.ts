import { EngagementReminderMail, ReminderType } from '../mail.types';

/**
 * Professional-tone engagement reminder copy. Kept isolated from the transport
 * (MailService) so copy can be reviewed/edited without touching send logic.
 *
 * Two variants:
 *  - NEVER_STARTED — enrolled but never opened the course.
 *  - STALLED       — had activity, then went quiet.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SIGN_OFF = 'Greenwich Training Centre';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(bodyHtml: string, ctaLabel: string, ctaUrl: string): string {
  const safeUrl = escapeHtml(ctaUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;max-width:560px;">
            <tr><td style="font-size:15px;line-height:1.6;color:#1f2933;">
              ${bodyHtml}
              <div style="margin:28px 0;">
                <a href="${safeUrl}" style="display:inline-block;background:#0b6b3a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">${escapeHtml(
                  ctaLabel,
                )}</a>
              </div>
              <p style="margin:0;color:#52606d;font-size:14px;">Kind regards,<br/>${SIGN_OFF}</p>
            </td></tr>
          </table>
          <p style="color:#9aa5b1;font-size:12px;margin:16px 0 0;">This is an automated message from ${SIGN_OFF}.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEngagementReminder(
  mail: EngagementReminderMail,
): RenderedEmail {
  const firstName = escapeHtml(mail.firstName || 'there');
  const courseTitle = escapeHtml(mail.courseTitle);

  if (mail.reminderType === ReminderType.NEVER_STARTED) {
    const subject = `Your enrolment in ${mail.courseTitle} — getting started`;
    const html = layout(
      `<p style="margin:0 0 16px;">Dear ${firstName},</p>
       <p style="margin:0 0 16px;">Our records show that you enrolled in <strong>${courseTitle}</strong> but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.</p>`,
      'Begin course',
      mail.courseUrl,
    );
    const text = `Dear ${mail.firstName || 'there'},

Our records show that you enrolled in ${
      mail.courseTitle
    } but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.

Begin course: ${mail.courseUrl}

Kind regards,
${SIGN_OFF}`;
    return { subject, html, text };
  }

  // STALLED
  const subject = `Continuing your ${mail.courseTitle} course`;
  const html = layout(
    `<p style="margin:0 0 16px;">Dear ${firstName},</p>
     <p style="margin:0 0 16px;">We noticed it has been some time since your last activity in <strong>${courseTitle}</strong>. Your progress has been saved, and you may resume from where you left off at any time.</p>`,
    'Resume course',
    mail.courseUrl,
  );
  const text = `Dear ${mail.firstName || 'there'},

We noticed it has been some time since your last activity in ${
    mail.courseTitle
  }. Your progress has been saved, and you may resume from where you left off at any time.

Resume course: ${mail.courseUrl}

Kind regards,
${SIGN_OFF}`;
  return { subject, html, text };
}
