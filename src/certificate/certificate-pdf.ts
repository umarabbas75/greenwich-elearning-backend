import { PDFDocument, PDFPage, PDFString } from '@cantoo/pdf-lib';
import {
  CERTIFICATE_ID_PREFIX,
  COLUMN,
  FIELDS,
  QR as QR_LAYOUT,
  toPdfY,
} from './certificate-layout';
import { drawBlock, embedCertificateFonts } from './certificate-draw';
import { loadCertificateTemplateBytes } from './certificate-template';
import { formatCertificateTitle } from './certificate-text';
import QRCode = require('qrcode');

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

/** Draws the verification QR into the slot the template outlines. */
async function drawVerifyQr(
  doc: PDFDocument,
  page: PDFPage,
  verifyUrl: string,
): Promise<PdfRect> {
  // 256px is ~2.6x the 92pt slot, past the point where more pixels show up in
  // print, and a quarter the cost of rendering at 512.
  const png = await QRCode.toBuffer(verifyUrl, {
    type: 'png',
    width: 256,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#1D2739', light: '#FFFFFF' },
  });
  const image = await doc.embedPng(png);

  // Inset so the code sits inside the slot's gold keyline.
  const pad = 6;
  const size = QR_LAYOUT.size - pad * 2;
  const x = QR_LAYOUT.x + pad;
  const y = toPdfY(QR_LAYOUT.y + QR_LAYOUT.size - pad);
  page.drawImage(image, { x, y, width: size, height: size });
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
 * Stamps learner, course, date, certificate id and the verification QR onto
 * the designed template.
 *
 * Positions and type come from certificate-layout.ts, the same module the
 * template builder draws from, so the stamped values land exactly where the
 * artwork leaves room for them. Long course titles wrap to a second line
 * rather than shrinking away to nothing.
 */
export async function renderCertificatePdf(
  data: CertificatePdfData,
): Promise<Uint8Array> {
  const templateBytes = loadCertificateTemplateBytes();
  const stamped = await PDFDocument.load(templateBytes);
  flattenTemplateForm(stamped);
  const page = stamped.getPages()[0];
  // Only the faces the four stamped fields use — the rest are already drawn
  // into the template, so re-embedding them would just bloat every download.
  const fonts = await embedCertificateFonts(stamped, [
    'script',
    'serifBold',
    'serif',
    'sans',
  ] as const);

  const learnerName = formatCertificateTitle(data.learnerName) || 'Learner';
  drawBlock(page, learnerName, FIELDS.learnerName, fonts.script, COLUMN.center);

  const courseTitle = formatCertificateTitle(data.courseTitle) || 'Course';
  drawBlock(
    page,
    courseTitle,
    FIELDS.courseTitle,
    fonts.serifBold,
    COLUMN.center,
    2,
  );

  const dateStr = data.issuedAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  drawBlock(page, dateStr, FIELDS.issuedDate, fonts.serif, COLUMN.center);

  drawBlock(
    page,
    `${CERTIFICATE_ID_PREFIX}${data.certificateId}`,
    FIELDS.certificateId,
    fonts.sans,
    COLUMN.center,
  );

  const qrRect = await drawVerifyQr(stamped, page, data.verifyUrl);
  addUriLink(page, data.verifyUrl, qrRect);

  applyMetadata(stamped, data);

  return stamped.save();
}
