import { ContactMessageMail } from '../mail.types';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/** "Contact us" message, emailed to an admin so they can follow up. */
export function renderContactMessage(mail: ContactMessageMail): RenderedEmail {
  const sender = escapeHtml(mail.senderName || 'A user');
  const senderEmail = escapeHtml(mail.senderEmail);
  const message = escapeHtml(mail.message);
  const url = `${BRAND.website}`;
  const body = `<p>A new message has been submitted through the contact form.</p>
    <p style="margin-top:12px;"><strong>From:</strong> ${sender} (${senderEmail})</p>
    <p style="margin-top:12px;"><strong>Message:</strong></p>
    <p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;white-space:pre-wrap;">${message}</p>`;
  return {
    subject: `New contact message from ${mail.senderName || mail.senderEmail}`,
    html: layout({
      heading: 'New contact message',
      bodyHtml: body,
      ctaLabel: 'Open dashboard',
      ctaUrl: url,
    }),
    text: `New contact message.\n\nFrom: ${mail.senderName || 'A user'} (${
      mail.senderEmail
    })\n\nMessage:\n${mail.message}\n\nOpen the dashboard: ${url}`,
  };
}
