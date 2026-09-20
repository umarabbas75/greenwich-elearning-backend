import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
} from '@cantoo/pdf-lib';
import { renderCertificatePdf } from './certificate-pdf';
import { CLIENT_PAGE, CLIENT_QR } from './certificate-layout';

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

  it('outputs an A4 landscape page matching the client artwork', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Working at Height',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-SIZE0001',
      verifyUrl: VERIFY_URL,
    });

    const page = (await PDFDocument.load(bytes)).getPages()[0];
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(CLIENT_PAGE.width, 1);
    expect(height).toBeCloseTo(CLIENT_PAGE.height, 1);

    // Exact A4: 297 x 210mm.
    expect((width * 25.4) / 72).toBeCloseTo(297, 0);
    expect((height * 25.4) / 72).toBeCloseTo(210, 0);
  });

  it('puts the verify link exactly over the QR the artwork reserves', async () => {
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

    // Inside the page...
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThanOrEqual(width);
    expect(y2).toBeLessThanOrEqual(height);

    // ...and covering the reserved square (the link carries a 2pt pad).
    const expectedY = CLIENT_PAGE.height - CLIENT_QR.y - CLIENT_QR.size;
    expect(x1).toBeCloseTo(CLIENT_QR.x - 2, 1);
    expect(y1).toBeCloseTo(expectedY - 2, 1);
    expect(x2 - x1).toBeCloseTo(CLIENT_QR.size + 4, 1);
    expect(y2 - y1).toBeCloseTo(CLIENT_QR.size + 4, 1);
  });

  it('keeps the QR large enough to carry a production verify URL', async () => {
    // 70-character production URL needs 37 modules; below ~48pt each module
    // falls under 0.4mm and scanners stop reading it.
    const PRODUCTION_URL =
      'https://www.greenwichtc-elearning.com/certificates/verify/GTC-7QK2M9XB';
    expect(PRODUCTION_URL.length).toBeGreaterThan(60);
    expect(CLIENT_QR.size).toBeGreaterThanOrEqual(48);
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
