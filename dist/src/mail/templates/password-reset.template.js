"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPasswordReset = void 0;
const mail_layout_1 = require("./mail-layout");
function renderPasswordReset(mail) {
    const firstName = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const otp = (0, mail_layout_1.escapeHtml)(mail.otp);
    const mins = mail.expiresInMinutes;
    const codeBlock = `<div style="margin:24px 0;padding:18px;text-align:center;background:#f4f5f7;border-radius:10px;">
      <span style="font-size:30px;font-weight:600;letter-spacing:8px;color:${mail_layout_1.BRAND.primary};">${otp}</span>
    </div>`;
    const bodyHtml = `<p>Dear ${firstName},</p>
    <p style="margin-top:12px;">We received a request to reset the password for your ${(0, mail_layout_1.escapeHtml)(mail_layout_1.BRAND.name)} account. Use the verification code below to continue:</p>
    ${codeBlock}
    <p>This code will expire in <strong>${mins} minutes</strong>. For your security, do not share it with anyone.</p>
    <p style="margin-top:12px;color:${mail_layout_1.BRAND.muted};font-size:13px;">If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.</p>`;
    const html = (0, mail_layout_1.layout)({
        heading: 'Reset your password',
        bodyHtml,
    });
    const text = `Dear ${mail.firstName || 'there'},

We received a request to reset the password for your ${mail_layout_1.BRAND.name} account.

Your verification code is: ${mail.otp}

This code will expire in ${mins} minutes. For your security, do not share it with anyone.

If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.

Kind regards,
The ${mail_layout_1.BRAND.name} Team`;
    return { subject: `Your ${mail_layout_1.BRAND.name} password reset code`, html, text };
}
exports.renderPasswordReset = renderPasswordReset;
//# sourceMappingURL=password-reset.template.js.map