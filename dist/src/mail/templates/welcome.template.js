"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWelcome = void 0;
const mail_layout_1 = require("./mail-layout");
function renderWelcome(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const url = `${mail_layout_1.BRAND.website}`;
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Welcome to ${(0, mail_layout_1.escapeHtml)(mail_layout_1.BRAND.name)}. Your account has been created successfully. You can now sign in to browse your courses and begin learning at your own pace.</p>
    <p style="margin-top:12px;">If a course has been assigned to you, it will appear on your dashboard once activated.</p>`;
    return {
        subject: `Welcome to ${mail_layout_1.BRAND.name}`,
        html: (0, mail_layout_1.layout)({
            heading: 'Welcome aboard',
            bodyHtml: body,
            ctaLabel: 'Sign in',
            ctaUrl: url,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nWelcome to ${mail_layout_1.BRAND.name}. Your account has been created successfully. You can now sign in to browse your courses and begin learning.\n\nSign in: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderWelcome = renderWelcome;
//# sourceMappingURL=welcome.template.js.map