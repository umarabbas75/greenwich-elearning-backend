import { formatCertificateTitle } from './certificate-text';

describe('formatCertificateTitle', () => {
  it('title-cases a lowercase learner name', () => {
    expect(formatCertificateTitle('umar student')).toBe('Umar Student');
  });

  it('title-cases a lowercase course title', () => {
    expect(
      formatCertificateTitle('occupational health & safety management'),
    ).toBe('Occupational Health & Safety Management');
  });

  it('keeps short all-caps tokens such as ISO', () => {
    expect(formatCertificateTitle('ISO 45001 foundation')).toBe(
      'ISO 45001 Foundation',
    );
  });

  it('title-cases hyphenated words', () => {
    expect(formatCertificateTitle('fire-safety level 2')).toBe(
      'Fire-Safety Level 2',
    );
  });

  it('trims extra whitespace', () => {
    expect(formatCertificateTitle('  jane   doe  ')).toBe('Jane Doe');
  });
});
