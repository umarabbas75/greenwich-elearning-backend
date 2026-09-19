import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';

let cachedTemplateBytes: Uint8Array | null = null;

/** Resolves the designed PDF background shipped with the backend. */
export function loadCertificateTemplateBytes(): Uint8Array {
  if (cachedTemplateBytes) return cachedTemplateBytes;

  // An explicit override lets a variant template be rendered for comparison
  // without touching the shipped asset. Field positions are shared, so any
  // override must be built from the same layout module.
  const override = process.env.CERTIFICATE_TEMPLATE;

  // Only the shipped asset — the stamped field positions come from
  // certificate-layout.ts and are meaningless against any other artwork, so
  // falling back to an older PDF would silently produce a broken certificate.
  const candidates = [
    ...(override
      ? [isAbsolute(override) ? override : join(process.cwd(), override)]
      : []),
    join(__dirname, 'assets', 'certificate-of-completion.pdf'),
    join(
      process.cwd(),
      'dist',
      'src',
      'certificate',
      'assets',
      'certificate-of-completion.pdf',
    ),
    join(
      process.cwd(),
      'src',
      'certificate',
      'assets',
      'certificate-of-completion.pdf',
    ),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      cachedTemplateBytes = readFileSync(path);
      return cachedTemplateBytes;
    }
  }

  throw new Error(
    'Certificate template PDF not found. Expected src/certificate/assets/certificate-of-completion.pdf',
  );
}

/** Test helper — clears the in-memory template cache. */
export function clearCertificateTemplateCache(): void {
  cachedTemplateBytes = null;
}
