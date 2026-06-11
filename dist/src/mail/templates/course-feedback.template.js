"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderFeedbackReceivedAdmin = exports.renderFeedbackReceived = exports.renderFeedbackReminder = exports.renderFeedbackRequest = exports.renderCourseCompleted = void 0;
const mail_layout_1 = require("./mail-layout");
const STUDENT_COURSES_URL = `${mail_layout_1.BRAND.website}/studentCourses`;
function feedbackCoursesUrl(courseId) {
    return courseId
        ? `${STUDENT_COURSES_URL}?feedbackCourseId=${encodeURIComponent(courseId)}`
        : STUDENT_COURSES_URL;
}
function renderCourseCompleted(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Congratulations on completing <strong>${title}</strong>! You have worked through all of the course content — a real achievement.</p>
    <p style="margin-top:12px;">You can revisit the material at any time from your dashboard.</p>`;
    return {
        subject: `Congratulations on completing ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'Course completed 🎉',
            bodyHtml: body,
            ctaLabel: 'Go to my courses',
            ctaUrl: STUDENT_COURSES_URL,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nCongratulations on completing ${mail.courseTitle}! You have worked through all of the course content.\n\nYour courses: ${STUDENT_COURSES_URL}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderCourseCompleted = renderCourseCompleted;
function renderFeedbackRequest(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const ctaUrl = feedbackCoursesUrl(mail.courseId);
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Now that you have completed <strong>${title}</strong>, we would value your feedback. It takes only a couple of minutes and helps us improve the course for future learners.</p>`;
    return {
        subject: `Share your feedback on ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'We would love your feedback',
            bodyHtml: body,
            ctaLabel: 'Give feedback',
            ctaUrl,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nNow that you have completed ${mail.courseTitle}, we would value your feedback. It takes only a couple of minutes.\n\nGive feedback: ${ctaUrl}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderFeedbackRequest = renderFeedbackRequest;
function renderFeedbackReminder(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const ctaUrl = feedbackCoursesUrl(mail.courseId);
    const body = `<p>Hi ${name},</p>
    <p style="margin-top:12px;">You finished <strong>${title}</strong> — would you mind sharing a few words about your experience? It takes about 2 minutes.</p>`;
    return {
        subject: `A quick favour about your recent course`,
        html: (0, mail_layout_1.layout)({
            heading: 'We would love your feedback',
            bodyHtml: body,
            ctaLabel: 'Give feedback',
            ctaUrl,
        }),
        text: `Hi ${mail.firstName || 'there'},\n\nYou finished ${mail.courseTitle} — would you mind sharing a few words about your experience? It takes about 2 minutes.\n\nGive feedback: ${ctaUrl}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderFeedbackReminder = renderFeedbackReminder;
function renderFeedbackReceived(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Thank you — your feedback for <strong>${title}</strong> has been registered. We appreciate you taking the time to help us improve.</p>`;
    return {
        subject: `Thank you for your feedback on ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'Feedback received',
            bodyHtml: body,
            ctaLabel: 'Go to my courses',
            ctaUrl: STUDENT_COURSES_URL,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nThank you — your feedback for ${mail.courseTitle} has been registered.\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderFeedbackReceived = renderFeedbackReceived;
function renderFeedbackReceivedAdmin(mail) {
    const student = (0, mail_layout_1.escapeHtml)(mail.studentName || 'A student');
    const studentEmail = (0, mail_layout_1.escapeHtml)(mail.studentEmail);
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const url = `${mail_layout_1.BRAND.website}`;
    const body = `<p>A new course feedback submission has been received.</p>
    <p style="margin-top:12px;"><strong>Student:</strong> ${student} (${studentEmail})</p>
    <p style="margin-top:4px;"><strong>Course:</strong> ${title}</p>
    <p style="margin-top:12px;">You can review it in the admin dashboard.</p>`;
    return {
        subject: `New feedback for ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'New course feedback',
            bodyHtml: body,
            ctaLabel: 'Open dashboard',
            ctaUrl: url,
        }),
        text: `New course feedback received.\n\nStudent: ${mail.studentName || 'A student'} (${mail.studentEmail})\nCourse: ${mail.courseTitle}\n\nReview it in the dashboard: ${url}`,
    };
}
exports.renderFeedbackReceivedAdmin = renderFeedbackReceivedAdmin;
//# sourceMappingURL=course-feedback.template.js.map