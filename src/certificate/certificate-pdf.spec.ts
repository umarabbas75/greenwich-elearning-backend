import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
} from '@cantoo/pdf-lib';
import { renderCertificatePdf } from './certificate-pdf';

const VERIFY_URL =
  'https://www.greenwichtc-elearning.com/certificates/verify/GTC-ABCD1234';

// Rendering embeds four TTFs and a QR into the designed template, so these
// take longer than Jest's 5s default.
jest.setTimeout(30_000);

describe('renderCertificatePdf', () => {
  it('returns a non-empty PDF with a QR image and a clickable verify link', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'umar student',
      courseTitle: 'fire safety management',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-ABCD1234',
      verifyUrl: VERIFY_URL,
      scorePct: 92,
    });

    expect(bytes.byteLength).toBeGreaterThan(100_000);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF');
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('/Encrypt');

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getTitle()).toContain('GTC-ABCD1234');
    expect(loaded.getSubject()).toContain(VERIFY_URL);

    const page = loaded.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeTruthy();
    expect(annots!.size()).toBeGreaterThanOrEqual(1);
  });

  it('outputs an A4 landscape page', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Working at Height',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-SIZE0001',
      verifyUrl: VERIFY_URL,
    });

    const page = (await PDFDocument.load(bytes)).getPages()[0];
    const { width, height } = page.getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);

    // Within half a millimetre of 297 x 210mm.
    expect((width * 25.4) / 72).toBeCloseTo(297, 0);
    expect((height * 25.4) / 72).toBeCloseTo(210, 0);
  });

  it('scales the verify link annotation onto the A4 page', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Working at Height',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-LINK0001',
      verifyUrl: VERIFY_URL,
    });

    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    const { width, height } = page.getSize();

    const annots = page.node.Annots();
    expect(annots?.size()).toBe(1);

    const annot = annots!.lookup(0, PDFDict);
    const rect = annot.lookup(PDFName.of('Rect'), PDFArray);
    const [x1, y1, x2, y2] = rect
      .asArray()
      .map((n) => (n as PDFNumber).asNumber());

    // If the annotation had not been scaled with the page it would still be
    // out on the 1684x1190 artboard, far outside these bounds.
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThanOrEqual(width);
    expect(y2).toBeLessThanOrEqual(height);

    // And it should land in the lower-right quadrant, where the QR sits.
    expect(x1).toBeGreaterThan(width / 2);
    expect(y2).toBeLessThan(height / 2);
  });

  it('renders a very long course title without failing', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Christopher Adebayo-Williams',
      courseTitle:
        'International Fire Safety Principles: Prevention, Protection and Emergency Response for Industrial Sites',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-LONG0001',
      verifyUrl: VERIFY_URL,
    });

    expect(bytes.byteLength).toBeGreaterThan(100_000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
