import { renderCertificatePdf } from './certificate-pdf';

describe('renderCertificatePdf', () => {
  it('returns a non-empty PDF buffer', async () => {
    const bytes = await renderCertificatePdf({
      learnerName: 'Jane Doe',
      courseTitle: 'Fire Safety Management',
      issuedAt: new Date('2026-08-31T00:00:00.000Z'),
      certificateId: 'GTC-ABCD1234',
      verifyUrl: 'https://www.greenwichtc-elearning.com/certificates/verify/GTC-ABCD1234',
      scorePct: 92,
    });

    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF');
  });
});
