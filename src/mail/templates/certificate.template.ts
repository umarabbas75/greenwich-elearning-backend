import { CertificateIssuedMail } from '../mail.types';
import { certificateVerify, studentCourseDetail } from '../mail-paths';
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
