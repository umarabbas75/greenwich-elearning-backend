import { RegistrationReceivedMail } from '../mail.types';
import { studentCourseFormPage } from '../mail-paths';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/** Learner confirmation after submitting a v2 registration form. */
export function renderRegistrationReceived(
  mail: RegistrationReceivedMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const url = studentCourseFormPage(mail.courseId);
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">We received your registration for <strong>${title}</strong>. A learning advisor will review it shortly.</p>
    <p style="margin-top:12px;">You can still complete other course requirements while you wait. Course content unlocks after your registration is approved and the remaining requirements are complete.</p>`;
  return {
    subject: `We received your registration for ${mail.courseTitle}`,
    html: layout({
      heading: 'Registration received',
      bodyHtml: body,
      ctaLabel: 'View course requirements',
      ctaUrl: url,
    }),
    text: `Dear ${mail.firstName || 'there'},\n\nWe received your registration for "${
      mail.courseTitle
    }". A learning advisor will review it shortly.\n\nYou can still complete other course requirements while you wait.\n\nView them: ${url}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}
