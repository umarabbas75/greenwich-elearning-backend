import {
  PDFDocument,
  PDFFont,
  PDFPage,
  RGB,
  StandardFonts,
} from 'pdf-lib';
import { CERTIFICATE_LAYOUT, CertificateFieldLayout } from './certificate-layout';
import { loadCertificateTemplateBytes } from './certificate-template';

export interface CertificatePdfData {
  learnerName: string;
  courseTitle: string;
  issuedAt: Date;
  certificateId: string;
  verifyUrl: string;
  scorePct?: number | null;
}

function fitFontSize(
  text: string,
  font: PDFFont,
  startSize: number,
  maxWidth: number,
): number {
  let size = startSize;
  while (size > 10 && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function drawField(
  page: PDFPage,
  text: string,
  pageWidth: number,
  pageHeight: number,
  layout: CertificateFieldLayout,
  font: PDFFont,
  boldFont: PDFFont,
): void {
  const activeFont = layout.bold ? boldFont : font;
  const maxWidth = layout.maxWidth ?? pageWidth * 0.75;
  const fontSize = fitFontSize(text, activeFont, layout.fontSize, maxWidth);
  const textWidth = activeFont.widthOfTextAtSize(text, fontSize);
  const y = pageHeight * layout.yRatio;

  let x: number;
  if (layout.x != null) {
    if (layout.align === 'right') {
      x = layout.x - textWidth;
    } else if (layout.align === 'center') {
      x = layout.x - textWidth / 2;
    } else {
      x = layout.x;
    }
  } else {
    x = (pageWidth - textWidth) / 2;
  }

  page.drawText(text, {
    x,
    y,
    size: fontSize,
    font: activeFont,
    color: layout.color,
  });
}

/**
 * Overlays learner/course/date fields onto the designed PDF template
 * (docs/certificate-of-completion.pdf).
 */
export async function renderCertificatePdf(
  data: CertificatePdfData,
): Promise<Uint8Array> {
  const templateBytes = loadCertificateTemplateBytes();
  const templateDoc = await PDFDocument.load(templateBytes);
  const [templatePage] = templateDoc.getPages();
  const { width: pageWidth, height: pageHeight } = templatePage.getSize();

  const doc = await PDFDocument.create();
  const [embeddedPage] = await doc.embedPdf(templateDoc, [0]);
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawPage(embeddedPage);

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const learnerName = data.learnerName.trim() || 'Learner';
  drawField(
    page,
    learnerName,
    pageWidth,
    pageHeight,
    CERTIFICATE_LAYOUT.learnerName,
    helvetica,
    helveticaBold,
  );

  const courseTitle = data.courseTitle.trim() || 'Course';
  drawField(
    page,
    courseTitle,
    pageWidth,
    pageHeight,
    CERTIFICATE_LAYOUT.courseTitle,
    helvetica,
    helveticaBold,
  );

  const dateStr = data.issuedAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  drawField(
    page,
    dateStr,
    pageWidth,
    pageHeight,
    CERTIFICATE_LAYOUT.issuedDate,
    helvetica,
    helveticaBold,
  );

  drawField(
    page,
    data.certificateId,
    pageWidth,
    pageHeight,
    CERTIFICATE_LAYOUT.certificateId,
    helvetica,
    helveticaBold,
  );

  return doc.save();
}
