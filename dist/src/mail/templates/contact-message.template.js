"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderContactMessage = void 0;
const mail_paths_1 = require("../mail-paths");
const mail_layout_1 = require("./mail-layout");
function renderContactMessage(mail) {
    const sender = (0, mail_layout_1.escapeHtml)(mail.senderName || 'A user');
    const senderEmail = (0, mail_layout_1.escapeHtml)(mail.senderEmail);
    const message = (0, mail_layout_1.escapeHtml)(mail.message);
    const url = (0, mail_paths_1.adminContactInbox)();
    const body = `<p>A new message has been submitted through the contact form.</p>
    <p style="margin-top:12px;"><strong>From:</strong> ${sender} (${senderEmail})</p>
    <p style="margin-top:12px;"><strong>Message:</strong></p>
    <p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;white-space:pre-wrap;">${message}</p>`;
    return {
        subject: `New contact message from ${mail.senderName || mail.senderEmail}`,
        html: (0, mail_layout_1.layout)({
            heading: 'New contact message',
            bodyHtml: body,
            ctaLabel: 'View messages',
            ctaUrl: url,
        }),
        text: `New contact message.\n\nFrom: ${mail.senderName || 'A user'} (${mail.senderEmail})\n\nMessage:\n${mail.message}\n\nView messages: ${url}`,
    };
}
exports.renderContactMessage = renderContactMessage;
//# sourceMappingURL=contact-message.template.js.map