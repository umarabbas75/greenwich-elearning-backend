import { normalizeCertificateId } from './certificate-id';

describe('normalizeCertificateId', () => {
  it('uppercases a valid GTC id', () => {
    expect(normalizeCertificateId('gtc-a1b2c3d4')).toBe('GTC-A1B2C3D4');
  });

  it('trims whitespace', () => {
    expect(normalizeCertificateId('  GTC-ABCD1234  ')).toBe('GTC-ABCD1234');
  });

  it('rejects junk so the public API can 404 without leaking why', () => {
    expect(normalizeCertificateId('')).toBeNull();
    expect(normalizeCertificateId('not-a-cert')).toBeNull();
    expect(normalizeCertificateId('GTC-')).toBeNull();
    expect(normalizeCertificateId('GTC-ZZZZZZZZ')).toBeNull();
  });
});
