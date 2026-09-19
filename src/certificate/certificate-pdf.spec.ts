import { PDFDocument } from '@cantoo/pdf-lib';
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

  it('keeps the page at the designed A4-landscape size', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Working at Height',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-SIZE0001',
      verifyUrl: VERIFY_URL,
    });

    const page = (await PDFDocument.load(bytes)).getPages()[0];
    const { width, height } = page.getSize();
    expect(Math.round(width)).toBe(1684);
    expect(Math.round(height)).toBe(1190);
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
