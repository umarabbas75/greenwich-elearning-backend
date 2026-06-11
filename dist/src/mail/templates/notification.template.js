"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNotificationEmail = void 0;
const mail_paths_1 = require("../mail-paths");
const mail_layout_1 = require("./mail-layout");
function renderNotificationEmail(mail) {
    switch (mail.kind) {
        case 'FORUM_THREAD': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const title = (0, mail_layout_1.escapeHtml)(mail.threadTitle);
            const creator = (0, mail_layout_1.escapeHtml)(mail.creatorName);
            const url = (0, mail_paths_1.forumThread)(mail.threadId);
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">A new discussion, <strong>${title}</strong>, has been posted by ${creator}. Join the conversation when you have a moment.</p>`;
            return {
                subject: `New discussion: ${mail.threadTitle}`,
                html: (0, mail_layout_1.layout)({
                    heading: 'New discussion posted',
                    bodyHtml: body,
                    ctaLabel: 'View discussion',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\nA new discussion, "${mail.threadTitle}", has been posted by ${mail.creatorName}.\n\nView it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
        case 'FORUM_COMMENT': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const title = (0, mail_layout_1.escapeHtml)(mail.threadTitle);
            const commenter = (0, mail_layout_1.escapeHtml)(mail.commenterName);
            const excerpt = (0, mail_layout_1.escapeHtml)(mail.excerpt);
            const url = (0, mail_paths_1.forumThread)(mail.threadId);
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${commenter} replied in <strong>${title}</strong>:</p>
        <p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;font-style:italic;">"${excerpt}"</p>`;
            return {
                subject: `New reply in ${mail.threadTitle}`,
                html: (0, mail_layout_1.layout)({
                    heading: 'New reply to a discussion',
                    bodyHtml: body,
                    ctaLabel: 'View reply',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\n${mail.commenterName} replied in "${mail.threadTitle}":\n"${mail.excerpt}"\n\nView it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
        case 'ASSESSMENT_SUBMITTED': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const student = (0, mail_layout_1.escapeHtml)(mail.studentName);
            const title = (0, mail_layout_1.escapeHtml)(mail.assessmentTitle);
            const url = (0, mail_paths_1.assessmentGrade)(mail.attemptId);
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${student} has submitted the assessment <strong>${title}</strong> and it is ready for grading.</p>`;
            return {
                subject: `Assessment submitted by ${mail.studentName}`,
                html: (0, mail_layout_1.layout)({
                    heading: 'An assessment is ready to grade',
                    bodyHtml: body,
                    ctaLabel: 'Grade assessment',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\n${mail.studentName} has submitted the assessment "${mail.assessmentTitle}" and it is ready for grading.\n\nGrade it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
        case 'ASSESSMENT_GRADED': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const title = (0, mail_layout_1.escapeHtml)(mail.assessmentTitle);
            const url = mail.courseId
                ? (0, mail_paths_1.studentCourseDetail)(mail.courseId)
                : (0, mail_paths_1.studentCoursesList)();
            const outcome = mail.passed == null
                ? ''
                : mail.passed
                    ? ` You <strong>passed</strong>${mail.scorePct != null
                        ? ` with ${Math.round(mail.scorePct)}%`
                        : ''}. Congratulations!`
                    : ` Your score was${mail.scorePct != null ? ` ${Math.round(mail.scorePct)}%` : ''}.`;
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">Your assessment <strong>${title}</strong> has been graded.${outcome}</p>`;
            return {
                subject: `Your assessment "${mail.assessmentTitle}" has been graded`,
                html: (0, mail_layout_1.layout)({
                    heading: 'Your assessment has been graded',
                    bodyHtml: body,
                    ctaLabel: 'View result',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\nYour assessment "${mail.assessmentTitle}" has been graded.${mail.passed == null ? '' : mail.passed ? ' You passed!' : ''}\n\nView it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
    }
}
exports.renderNotificationEmail = renderNotificationEmail;
//# sourceMappingURL=notification.template.js.map