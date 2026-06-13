"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNotificationEmail = void 0;
const mail_paths_1 = require("../mail-paths");
const mail_layout_1 = require("./mail-layout");
const SUBMISSION_STATUS_COPY = {
    submitted: {
        heading: 'Your submission was received',
        sentence: 'has been received and is queued for review',
    },
    in_review: {
        heading: 'Your submission is under review',
        sentence: 'is now being reviewed',
    },
    approved: {
        heading: 'Your submission has been approved',
        sentence: 'has been reviewed and approved',
    },
    rejected: {
        heading: 'Your submission was not accepted',
        sentence: 'has been reviewed and was not accepted',
    },
    returned: {
        heading: 'Your submission was returned for changes',
        sentence: 'was returned with feedback for changes',
    },
};
function formatDueAt(dueAt) {
    if (!dueAt)
        return '';
    const date = new Date(dueAt);
    if (Number.isNaN(date.getTime()))
        return '';
    return date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}
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
        case 'ASSIGNMENT_CREATED': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const title = (0, mail_layout_1.escapeHtml)(mail.assignmentTitle);
            const courseTitle = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
            const url = (0, mail_paths_1.studentAssignmentDetail)(mail.assignmentId);
            const dueLabel = formatDueAt(mail.dueAt);
            const dueLine = dueLabel
                ? `<p style="margin-top:8px;color:${mail_layout_1.BRAND.muted};font-size:13px;">Due: <strong>${(0, mail_layout_1.escapeHtml)(dueLabel)}</strong></p>`
                : '';
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">A new assignment, <strong>${title}</strong>, has been added to your course <strong>${courseTitle}</strong>.</p>${dueLine}`;
            return {
                subject: `New assignment: ${mail.assignmentTitle}`,
                html: (0, mail_layout_1.layout)({
                    heading: 'New assignment available',
                    bodyHtml: body,
                    ctaLabel: 'View assignment',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\nA new assignment, "${mail.assignmentTitle}", has been added to your course "${mail.courseTitle}".${dueLabel ? `\nDue: ${dueLabel}` : ''}\n\nView it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
        case 'ASSIGNMENT_SUBMITTED': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const student = (0, mail_layout_1.escapeHtml)(mail.studentName);
            const title = (0, mail_layout_1.escapeHtml)(mail.assignmentTitle);
            const url = (0, mail_paths_1.adminAssignmentSubmissions)(mail.assignmentId);
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${student} has submitted to the assignment <strong>${title}</strong> and it is ready for review.</p>`;
            return {
                subject: `Assignment submitted by ${mail.studentName}`,
                html: (0, mail_layout_1.layout)({
                    heading: 'A submission is ready to review',
                    bodyHtml: body,
                    ctaLabel: 'Review submission',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\n${mail.studentName} has submitted to the assignment "${mail.assignmentTitle}" and it is ready for review.\n\nReview it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
            };
        }
        case 'ASSIGNMENT_GRADED': {
            const name = (0, mail_layout_1.escapeHtml)(mail.recipientFirstName || 'there');
            const title = (0, mail_layout_1.escapeHtml)(mail.assignmentTitle);
            const url = (0, mail_paths_1.studentAssignmentDetail)(mail.assignmentId);
            const copy = SUBMISSION_STATUS_COPY[mail.submissionStatus];
            const scoreLine = typeof mail.score === 'number'
                ? `<p style="margin-top:8px;">Score: <strong>${mail.score}${typeof mail.maxPoints === 'number'
                    ? ` / ${mail.maxPoints}`
                    : ''}</strong></p>`
                : '';
            const feedbackLine = mail.feedback
                ? `<p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;font-style:italic;">"${(0, mail_layout_1.escapeHtml)(mail.feedback)}"</p>`
                : '';
            const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">Your submission for <strong>${title}</strong> ${copy.sentence}.</p>${scoreLine}${feedbackLine}`;
            return {
                subject: `Update on your submission: ${mail.assignmentTitle}`,
                html: (0, mail_layout_1.layout)({
                    heading: copy.heading,
                    bodyHtml: body,
                    ctaLabel: 'View submission',
                    ctaUrl: url,
                }),
                text: `Dear ${mail.recipientFirstName || 'there'},\n\nYour submission for "${mail.assignmentTitle}" ${copy.sentence}.${typeof mail.score === 'number'
                    ? `\nScore: ${mail.score}${typeof mail.maxPoints === 'number' ? ` / ${mail.maxPoints}` : ''}`
                    : ''}${mail.feedback ? `\nFeedback: ${mail.feedback}` : ''}\n\nView it: ${url}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
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