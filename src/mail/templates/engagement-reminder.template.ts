import { EngagementReminderMail, ReminderType } from '../mail.types';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/**
 * Professional-tone engagement reminder emails. Copy lives here; the shared
 * shell/branding lives in ./mail-layout. Kept isolated from the transport
 * (MailService) so copy can be reviewed and edited without touching send logic.
 *
 * Two variants:
 *  - NEVER_STARTED — enrolled but never opened the course.
 *  - STALLED       — had activity, then went quiet.
 */

/** Per-variant content the layout is filled with. */
interface Variant {
  subject: string;
  heading: string;
  /** Body paragraphs (already plain — escaped by the caller where they embed user data). */
  intro: string;
  ctaLabel: string;
  textBody: string;
}

/**
 * Builds the optional progress sentence for STALLED, e.g.
 * "You've completed 8 of 19 lessons (42%)". Returns null when there isn't
 * meaningful progress to report (no sections, or zero completed) so we never
 * show "0 of 0" or a discouraging 0%.
 */
function progressLine(mail: EngagementReminderMail): {
  html: string;
  text: string;
} | null {
  const done = mail.completedSections ?? 0;
  const total = mail.totalSections ?? 0;
  if (total <= 0 || done <= 0) return null;
  const safeDone = Math.min(done, total); // guard against over-count
  const pct = Math.round((safeDone / total) * 100);
  const sentence = `You've already completed ${safeDone} of ${total} lessons (${pct}%) — you're well on your way.`;
  return {
    html: `<p style="margin-top:12px;">${escapeHtml(sentence)}</p>`,
    text: sentence,
  };
}

/** Build the variant content for a given reminder, with user data escaped. */
function variantFor(mail: EngagementReminderMail): Variant {
  const firstName = escapeHtml(mail.firstName || 'there');
  const courseTitle = escapeHtml(mail.courseTitle);

  if (mail.reminderType === ReminderType.NEVER_STARTED) {
    // Optional duration nudge — only when the course has a duration set.
    const duration = (mail.courseDuration || '').trim();
    const durationHtml = duration
      ? `<p style="margin-top:12px;">This course is designed to be completed in around <strong>${escapeHtml(
          duration,
        )}</strong> — starting now keeps you comfortably on track.</p>`
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

Our records show that you enrolled in ${
        mail.courseTitle
      } but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.${durationText}`,
    };
  }

  // STALLED — weave in progress when we have it.
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

We noticed it has been some time since your last activity in ${
      mail.courseTitle
    }. Your progress has been saved, and you may resume from where you left off at any time.${progressText}`,
  };
}

export function renderEngagementReminder(
  mail: EngagementReminderMail,
): RenderedEmail {
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
