import { PasswordResetMail } from '../mail.types';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/**
 * Password-reset OTP email. Displays the 6-digit code prominently (no CTA
 * button — the user types the code back into the app). Copy is deliberately
 * security-conscious: states the expiry and tells the user to ignore it if they
 * didn't request a reset.
 */
export function renderPasswordReset(mail: PasswordResetMail): RenderedEmail {
  const firstName = escapeHtml(mail.firstName || 'there');
  const otp = escapeHtml(mail.otp);
  const mins = mail.expiresInMinutes;

  const codeBlock = `<div style="margin:24px 0;padding:18px;text-align:center;background:#f4f5f7;border-radius:10px;">
      <span style="font-size:30px;font-weight:600;letter-spacing:8px;color:${BRAND.primary};">${otp}</span>
    </div>`;

  const bodyHtml = `<p>Dear ${firstName},</p>
    <p style="margin-top:12px;">We received a request to reset the password for your ${escapeHtml(
      BRAND.name,
    )} account. Use the verification code below to continue:</p>
    ${codeBlock}
    <p>This code will expire in <strong>${mins} minutes</strong>. For your security, do not share it with anyone.</p>
    <p style="margin-top:12px;color:${
      BRAND.muted
    };font-size:13px;">If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.</p>`;

  const html = layout({
    heading: 'Reset your password',
    bodyHtml,
  });

  const text = `Dear ${mail.firstName || 'there'},

We received a request to reset the password for your ${BRAND.name} account.

Your verification code is: ${mail.otp}

This code will expire in ${mins} minutes. For your security, do not share it with anyone.

If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.

Kind regards,
The ${BRAND.name} Team`;

  return { subject: `Your ${BRAND.name} password reset code`, html, text };
}
