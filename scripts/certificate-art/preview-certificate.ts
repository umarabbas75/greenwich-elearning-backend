/**
 * Renders sample certificates from the real stamping path so the design can be
 * eyeballed without touching the database.
 *
 * Run: yarn script:certificate:preview
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderCertificatePdf } from '../../src/certificate/certificate-pdf';

const VARIANT = (() => {
  const i = process.argv.indexOf('--variant');
  return i >= 0 ? process.argv[i + 1] : 'a';
})();

const TEMPLATES: Record<string, string> = {
  a: 'certificate-of-completion.pdf',
  b: 'certificate-of-completion-variant-b.pdf',
};

const OUT = join(
  __dirname,
  '..',
  '..',
  'docs',
  'certificate-previews',
  VARIANT === 'a' ? '.' : `variant-${VARIANT}`,
);

const SAMPLES = [
  {
    file: 'typical.pdf',
    learnerName: 'Aisha Rahman',
    courseTitle: 'Level 3 Award in Health and Safety',
    certificateId: 'GTC-7QK2M9XB',
  },
  {
    file: 'long-course-title.pdf',
    learnerName: 'Christopher Adebayo-Williams',
    courseTitle:
      'International Fire Safety Principles: Prevention, Protection and Emergency Response',
    certificateId: 'GTC-4TH8N2PD',
  },
  {
    file: 'short.pdf',
    learnerName: 'Li Wei',
    courseTitle: 'NEBOSH IGC',
    certificateId: 'GTC-1AB2C3D4',
  },
];

async function main(): Promise<void> {
  const { mkdirSync } = await import('fs');
  mkdirSync(OUT, { recursive: true });

  const template = TEMPLATES[VARIANT];
  if (!template) {
    throw new Error(
      `Unknown variant "${VARIANT}". Expected: ${Object.keys(TEMPLATES).join(
        ', ',
      )}`,
    );
  }
  process.env.CERTIFICATE_TEMPLATE = join(
    __dirname,
    '..',
    '..',
    'src',
    'certificate',
    'assets',
    template,
  );

  for (const sample of SAMPLES) {
    const bytes = await renderCertificatePdf({
      learnerName: sample.learnerName,
      courseTitle: sample.courseTitle,
      issuedAt: new Date('2026-09-19T00:00:00Z'),
      certificateId: sample.certificateId,
      verifyUrl: `https://greenwichtc.com/verify/${sample.certificateId}`,
    });
    const path = join(OUT, sample.file);
    writeFileSync(path, bytes);
    console.log(`${sample.file} ${Math.round(bytes.length / 1024)} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
