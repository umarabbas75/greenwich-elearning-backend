import { WelcomeMail } from '../mail.types';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/** Welcome email sent when a user self-registers. */
export function renderWelcome(mail: WelcomeMail): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const url = `${BRAND.website}`;
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Welcome to ${escapeHtml(
      BRAND.name,
    )}. Your account has been created successfully. You can now sign in to browse your courses and begin learning at your own pace.</p>
    <p style="margin-top:12px;">If a course has been assigned to you, it will appear on your dashboard once activated.</p>`;
  return {
    subject: `Welcome to ${BRAND.name}`,
    html: layout({
      heading: 'Welcome aboard',
      bodyHtml: body,
      ctaLabel: 'Sign in',
      ctaUrl: url,
    }),
    text: `Dear ${mail.firstName || 'there'},\n\nWelcome to ${
      BRAND.name
    }. Your account has been created successfully. You can now sign in to browse your courses and begin learning.\n\nSign in: ${url}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}
