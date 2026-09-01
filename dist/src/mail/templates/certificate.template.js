"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCertificateIssuedAdmin = exports.renderCertificateIssued = void 0;
const mail_paths_1 = require("../mail-paths");
const mail_layout_1 = require("./mail-layout");
function renderCertificateIssued(mail) {
    const name = (0, mail_layout_1.escapeHtml)(mail.firstName || 'there');
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const certId = (0, mail_layout_1.escapeHtml)(mail.certificateId);
    const verifyUrl = mail.verifyUrl || (0, mail_paths_1.certificateVerify)(mail.certificateId);
    const ctaUrl = mail.courseId
        ? (0, mail_paths_1.studentCourseDetail)(mail.courseId)
        : mail.certificateUrl;
    const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Congratulations! Your certificate for <strong>${title}</strong> is ready.</p>
    <p style="margin-top:12px;">Certificate ID: <strong>${certId}</strong></p>
    <p style="margin-top:12px;">You can download your certificate using the button below. Anyone can verify its authenticity at:</p>
    <p style="margin-top:8px;"><a href="${(0, mail_layout_1.escapeHtml)(verifyUrl)}">${(0, mail_layout_1.escapeHtml)(verifyUrl)}</a></p>`;
    return {
        subject: `Your certificate for ${mail.courseTitle}`,
        html: (0, mail_layout_1.layout)({
            heading: 'Your certificate is ready',
            bodyHtml: body,
            ctaLabel: 'Download certificate',
            ctaUrl: mail.certificateUrl,
        }),
        text: `Dear ${mail.firstName || 'there'},\n\nYour certificate for ${mail.courseTitle} is ready.\n\nCertificate ID: ${mail.certificateId}\n\nDownload: ${mail.certificateUrl}\n\nVerify: ${verifyUrl}\n\nView course: ${ctaUrl}\n\nKind regards,\nThe ${mail_layout_1.BRAND.name} Team`,
    };
}
exports.renderCertificateIssued = renderCertificateIssued;
function renderCertificateIssuedAdmin(mail) {
    const student = (0, mail_layout_1.escapeHtml)(mail.studentName || 'A student');
    const studentEmail = (0, mail_layout_1.escapeHtml)(mail.studentEmail);
    const title = (0, mail_layout_1.escapeHtml)(mail.courseTitle);
    const certId = (0, mail_layout_1.escapeHtml)(mail.certificateId);
    const verifyUrl = mail.verifyUrl || (0, mail_paths_1.certificateVerify)(mail.certificateId);
    const adminUrl = (0, mail_paths_1.adminIssuedCertificates)();
    const body = `<p>A certificate has been automatically generated for a learner.</p>
    <p style="margin-top:12px;"><strong>Student:</strong> ${student} (${studentEmail})</p>
    <p style="margin-top:4px;"><strong>Course:</strong> ${title}</p>
    <p style="margin-top:4px;"><strong>Certificate ID:</strong> ${certId}</p>
    <p style="margin-top:12px;">Verify at: <a href="${(0, mail_layout_1.escapeHtml)(verifyUrl)}">${(0, mail_layout_1.escapeHtml)(verifyUrl)}</a></p>`;
    return {
        subject: `Certificate issued — ${mail.studentName} (${mail.courseTitle})`,
        html: (0, mail_layout_1.layout)({
            heading: 'Certificate auto-issued',
            bodyHtml: body,
            ctaLabel: 'View issued certificates',
            ctaUrl: adminUrl,
        }),
        text: `A certificate has been automatically generated.\n\nStudent: ${mail.studentName || 'A student'} (${mail.studentEmail})\nCourse: ${mail.courseTitle}\nCertificate ID: ${mail.certificateId}\n\nDownload: ${mail.certificateUrl}\nVerify: ${verifyUrl}\n\nView issued certificates: ${adminUrl}`,
    };
}
exports.renderCertificateIssuedAdmin = renderCertificateIssuedAdmin;
//# sourceMappingURL=certificate.template.js.map