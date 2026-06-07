"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEngagementReminder = void 0;
const mail_types_1 = require("../mail.types");
const mail_layout_1 = require("./mail-layout");
function progressLine(mail) {
    const done = mail.completedSections ?? 0;
    const total = mail.totalSections ?? 0;
    if (total <= 0 || done <= 0)
        return null;
    const safeDone = Math.min(done, total);
    const pct = Math.round((safeDone / total) * 100);
    const sentence = `You've already completed ${safeDone} of ${total} lessons (${pct}%) — you're well on your way.`;
    return {
        html: `<p style="margin-top:12px;">${(0, mail_layout_1.escapeHtml)(sentence)}</p>`,
        text: sentence,
    };
}
function variantFor(mail) {
    const firstName = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const courseTitle = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    if (mail.reminderType === mail_types_1.ReminderType.NEVER_STARTED) {
        const duration = (mail.courseDuration || '').trim();
        const durationHtml = duration
            ? `<p style="margin-top:12px;">This course is designed to be completed in around <strong>${(0, mail_layout_1.escapeHtml)(duration)}</strong> — starting now keeps you comfortably on track.</p>`
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

Our records show that you enrolled in ${mail.courseTitle} but have not yet begun the course. To make progress towards your certification, we encourage you to begin when convenient.${durationText}`,
        };
    }
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

We noticed it has been some time since your last activity in ${mail.courseTitle}. Your progress has been saved, and you may resume from where you left off at any time.${progressText}`,
    };
}
function renderEngagementReminder(mail) {
    const v = variantFor(mail);
    const html = (0, mail_layout_1.layout)({
        heading: v.heading,
        bodyHtml: v.intro,
        ctaLabel: v.ctaLabel,
        ctaUrl: mail.courseUrl,
    });
    const text = `${v.textBody}

${v.ctaLabel}: ${mail.courseUrl}

Kind regards,
The ${mail_layout_1.BRAND.name} Team`;
    return { subject: v.subject, html, text };
}
exports.renderEngagementReminder = renderEngagementReminder;
//# sourceMappingURL=engagement-reminder.template.js.map