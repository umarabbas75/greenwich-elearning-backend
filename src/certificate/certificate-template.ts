import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let cachedTemplateBytes: Uint8Array | null = null;

/** Resolves the designed PDF background shipped with the backend. */
export function loadCertificateTemplateBytes(): Uint8Array {
  if (cachedTemplateBytes) return cachedTemplateBytes;

  const candidates = [
    join(__dirname, 'assets', 'certificate-of-completion.pdf'),
    join(process.cwd(), 'dist', 'src', 'certificate', 'assets', 'certificate-of-completion.pdf'),
    join(process.cwd(), 'src', 'certificate', 'assets', 'certificate-of-completion.pdf'),
    join(process.cwd(), 'docs', 'certificate-of-completion-updated.pdf'),
    join(process.cwd(), 'docs', 'certificate-of-completion.pdf'),
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
