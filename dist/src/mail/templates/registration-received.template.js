"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRegistrationReceived = void 0;
const mail_paths_1 = require("../mail-paths");
const mail_layout_1 = require("./mail-layout");
function renderRegistrationReceived(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const url = (0, mail_paths_1.studentCourseFormPage)(mail.courseId);
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">We received your registration for <strong>${title}</strong>. A learning advisor will review it shortly.</p>
    <p style="margin-top:12px;">You can still complete other course requirements while you wait. Course content unlocks after your registration is approved and the remaining requirements are complete.</p>`;
    return {
        subject: `We received your registration for ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'Registration received',
            bodyHtml: body,
            ctaLabel: 'View course requirements',
            ctaUrl: url,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nWe received your registration for "${mail.courseTitle}". A learning advisor will review it shortly.\n\nYou can still complete other course requirements while you wait.\n\nView them: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderRegistrationReceived = renderRegistrationReceived;
//# sourceMappingURL=registration-received.template.js.map