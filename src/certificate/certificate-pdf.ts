import { PDFDocument, PDFPage, PDFString, rgb } from '@cantoo/pdf-lib';
import { CLIENT_FIELDS, CLIENT_PAGE, CLIENT_QR } from './certificate-layout';
import { drawField, embedCertificateFonts } from './certificate-draw';
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

/**
 * Draws the verification QR into the square the client's artwork reserves.
 *
 * The supplied design has a decorative QR placeholder; its interior is erased
 * when the template is built, and the real code is drawn inside the surviving
 * rounded border.
 */
function drawVerifyQr(page: PDFPage, verifyUrl: string): PdfRect {
  // Drawn as vector modules rather than an embedded bitmap. A 256px PNG scaled
  // into a 42pt square resamples badly — the rendered codes would not decode
  // even at 600 DPI, verified with two independent decoders. Vector modules
  // rasterise exactly at any resolution, and cost less than a PNG.
  const qr = QRCode.create(verifyUrl, { errorCorrectionLevel: 'M' });
  const modules = qr.modules;
  const count = modules.size;

  // The spec's 4-module quiet zone is supplied by the surrounding paper — the
  // decorative frame that used to sit against the modules is erased from the
  // template — so the full square carries modules.
  const QUIET = 0;
  const unit = CLIENT_QR.size / (count + QUIET * 2);
  const originX = CLIENT_QR.x;
  const originTop = CLIENT_QR.y;

  page.drawRectangle({
    x: originX,
    y: CLIENT_PAGE.height - originTop - CLIENT_QR.size,
    width: CLIENT_QR.size,
    height: CLIENT_QR.size,
    color: rgb(1, 1, 1),
  });

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!modules.get(row, col)) continue;
      const x = originX + (col + QUIET) * unit;
      const top = originTop + (row + QUIET) * unit;
      page.drawRectangle({
        x,
        y: CLIENT_PAGE.height - top - unit,
        // A hair of overlap stops hairline seams between adjacent modules.
        width: unit + 0.03,
        height: unit + 0.03,
        color: rgb(0.102, 0.227, 0.141),
      });
    }
  }

  return {
    x: originX,
    y: CLIENT_PAGE.height - originTop - CLIENT_QR.size,
    width: CLIENT_QR.size,
    height: CLIENT_QR.size,
  };
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
 * the client's approved certificate design.
 *
 * The client supplied that design as a flattened 300 DPI raster with its
 * placeholders drawn in, so the template build erases those regions and the
 * positions here (certificate-layout.ts, CLIENT_FIELDS) were measured off the
 * original artwork. Values are baseline-anchored to land exactly where the
 * placeholder text sat.
 */
export async function renderCertificatePdf(
  data: CertificatePdfData,
): Promise<Uint8Array> {
  const templateBytes = loadCertificateTemplateBytes();
  const stamped = await PDFDocument.load(templateBytes);
  flattenTemplateForm(stamped);
  const page = stamped.getPages()[0];

  const fonts = await embedCertificateFonts(stamped, [
    'sansHeavy',
    'sans',
  ] as const);

  const pageHeight = page.getSize().height;

  drawField(
    page,
    formatCertificateTitle(data.learnerName) || 'Learner',
    CLIENT_FIELDS.learnerName,
    fonts.sansHeavy,
    pageHeight,
  );

  drawField(
    page,
    formatCertificateTitle(data.courseTitle) || 'Course',
    CLIENT_FIELDS.courseTitle,
    fonts.sansHeavy,
    pageHeight,
  );

  drawField(
    page,
    data.certificateId,
    CLIENT_FIELDS.certificateId,
    fonts.sans,
    pageHeight,
  );

  drawField(
    page,
    data.issuedAt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    CLIENT_FIELDS.issuedDate,
    fonts.sans,
    pageHeight,
  );

  const qrRect = drawVerifyQr(page, data.verifyUrl);
  addUriLink(page, data.verifyUrl, qrRect);

  applyMetadata(stamped, data);

  return stamped.save();
}
