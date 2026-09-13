import {
  PDFDocument,
  PDFFont,
  PDFPage,
  PDFString,
  StandardFonts,
} from '@cantoo/pdf-lib';
import QRCode = require('qrcode');
import { CERTIFICATE_LAYOUT, CertificateFieldLayout } from './certificate-layout';
import { loadCertificateTemplateBytes } from './certificate-template';
import { formatCertificateTitle } from './certificate-text';

export interface CertificatePdfData {
  learnerName: string;
  courseTitle: string;
  issuedAt: Date;
  certificateId: string;
  verifyUrl: string;
  scorePct?: number | null;
}

interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fitFontSize(
  text: string,
  font: PDFFont,
  startSize: number,
  maxWidth: number,
): number {
  let size = startSize;
  while (size > 7 && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
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

function addUriLink(page: PDFPage, uri: string, rect: PdfRect): void {
  const pad = 2;
  const link = page.doc.context.register(
    page.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [
        rect.x - pad,
        rect.y - pad,
        rect.x + rect.width + pad,
        rect.y + rect.height + pad,
      ],
      Border: [0, 0, 0],
      A: {
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of(uri),
      },
    }),
  );
  page.node.addAnnot(link);
}

async function drawVerifyQr(
  doc: PDFDocument,
  page: PDFPage,
  verifyUrl: string,
): Promise<PdfRect> {
  const png = await QRCode.toBuffer(verifyUrl, {
    type: 'png',
    width: 256,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1B2420', light: '#FFFFFF' },
  });
  const qrImage = await doc.embedPng(png);
  const { size, x, y } = CERTIFICATE_LAYOUT.qr;
  page.drawImage(qrImage, { x, y, width: size, height: size });
  return { x, y, width: size, height: size };
}

function applyMetadata(doc: PDFDocument, data: CertificatePdfData): void {
  doc.setTitle(`Certificate of Completion — ${data.certificateId}`);
  doc.setAuthor('Greenwich Training & Consulting');
  doc.setSubject(`Verify at ${data.verifyUrl}`);
  doc.setKeywords([
    data.certificateId,
    'certificate of completion',
    'Greenwich Training & Consulting',
    data.verifyUrl,
  ]);
  doc.setProducer('Greenwich Training & Consulting');
  doc.setCreator('Greenwich eLearning');
  doc.setCreationDate(data.issuedAt);
  doc.setModificationDate(data.issuedAt);
}

function flattenTemplateForm(templateDoc: PDFDocument): void {
  try {
    const form = templateDoc.getForm();
    if (form.getFields().length > 0) {
      form.flatten();
    }
  } catch {
    // Template is a designed page, not an AcroForm — nothing to flatten.
  }
}

/**
 * Stamp learner/course/date/ID and a verification QR inside the card.
 * Overlay is drawn into the page content stream (not AcroForm fields).
 * Template form fields, if any, are flattened.
 */
export async function renderCertificatePdf(
  data: CertificatePdfData,
): Promise<Uint8Array> {
  const templateBytes = loadCertificateTemplateBytes();
  const stamped = await PDFDocument.load(templateBytes);
  flattenTemplateForm(stamped);
  const page = stamped.getPages()[0];
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const helvetica = await stamped.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await stamped.embedFont(StandardFonts.HelveticaBold);

  const learnerName =
    formatCertificateTitle(data.learnerName) || 'Learner';
  drawField(
    page,
    learnerName,
    pageWidth,
    pageHeight,
    CERTIFICATE_LAYOUT.learnerName,
    helvetica,
    helveticaBold,
  );

  const courseTitle = formatCertificateTitle(data.courseTitle) || 'Course';
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

  const qrRect = await drawVerifyQr(stamped, page, data.verifyUrl);
  addUriLink(page, data.verifyUrl, qrRect);

  applyMetadata(stamped, data);

  return stamped.save();
}
