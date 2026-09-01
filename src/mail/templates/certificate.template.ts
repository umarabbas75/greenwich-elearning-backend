import { CertificateIssuedAdminMail, CertificateIssuedMail } from '../mail.types';
import {
  adminIssuedCertificates,
  certificateVerify,
  studentCourseDetail,
} from '../mail-paths';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/** Certificate issued — download link + verification URL. */
export function renderCertificateIssued(
  mail: CertificateIssuedMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const certId = escapeHtml(mail.certificateId);
  const verifyUrl = mail.verifyUrl || certificateVerify(mail.certificateId);
  const ctaUrl = mail.courseId
    ? studentCourseDetail(mail.courseId)
    : mail.certificateUrl;

  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Congratulations! Your certificate for <strong>${title}</strong> is ready.</p>
    <p style="margin-top:12px;">Certificate ID: <strong>${certId}</strong></p>
    <p style="margin-top:12px;">You can download your certificate using the button below. Anyone can verify its authenticity at:</p>
    <p style="margin-top:8px;"><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>`;

  return {
    subject: `Your certificate for ${mail.courseTitle}`,
    html: layout({
      heading: 'Your certificate is ready',
      bodyHtml: body,
      ctaLabel: 'Download certificate',
      ctaUrl: mail.certificateUrl,
    }),
    text: `Dear ${mail.firstName || 'there'},\n\nYour certificate for ${
      mail.courseTitle
    } is ready.\n\nCertificate ID: ${mail.certificateId}\n\nDownload: ${
      mail.certificateUrl
    }\n\nVerify: ${verifyUrl}\n\nView course: ${ctaUrl}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}

/** Notifies the admin when a certificate is auto-generated for a learner. */
export function renderCertificateIssuedAdmin(
  mail: CertificateIssuedAdminMail,
): RenderedEmail {
  const student = escapeHtml(mail.studentName || 'A student');
  const studentEmail = escapeHtml(mail.studentEmail);
  const title = escapeHtml(mail.courseTitle);
  const certId = escapeHtml(mail.certificateId);
  const verifyUrl = mail.verifyUrl || certificateVerify(mail.certificateId);
  const adminUrl = adminIssuedCertificates();

  const body = `<p>A certificate has been automatically generated for a learner.</p>
    <p style="margin-top:12px;"><strong>Student:</strong> ${student} (${studentEmail})</p>
    <p style="margin-top:4px;"><strong>Course:</strong> ${title}</p>
    <p style="margin-top:4px;"><strong>Certificate ID:</strong> ${certId}</p>
    <p style="margin-top:12px;">Verify at: <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>`;

  return {
    subject: `Certificate issued — ${mail.studentName} (${mail.courseTitle})`,
    html: layout({
      heading: 'Certificate auto-issued',
      bodyHtml: body,
      ctaLabel: 'View issued certificates',
      ctaUrl: adminUrl,
    }),
    text: `A certificate has been automatically generated.\n\nStudent: ${
      mail.studentName || 'A student'
    } (${mail.studentEmail})\nCourse: ${mail.courseTitle}\nCertificate ID: ${
      mail.certificateId
    }\n\nDownload: ${mail.certificateUrl}\nVerify: ${verifyUrl}\n\nView issued certificates: ${adminUrl}`,
  };
}
