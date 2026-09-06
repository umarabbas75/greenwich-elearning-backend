/** Issued IDs are `GTC-` plus 8 hex chars; accept a slightly wider range on verify. */
const CERTIFICATE_ID_PATTERN = /^GTC-[A-F0-9]{8,16}$/;

/** Uppercases and validates a public certificate ID. Returns null if unusable. */
export function normalizeCertificateId(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  if (!CERTIFICATE_ID_PATTERN.test(normalized)) return null;
  return normalized;
}
