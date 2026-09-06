import { PDFDocument } from '@cantoo/pdf-lib';
import { renderCertificatePdf } from './certificate-pdf';

const VERIFY_URL =
  'https://www.greenwichtc-elearning.com/certificates/verify/GTC-ABCD1234';

describe('renderCertificatePdf', () => {
  it('returns a non-empty PDF with a QR image and a clickable verify link', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Fire Safety Management',
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
});
