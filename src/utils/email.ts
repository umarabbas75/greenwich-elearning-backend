/** Trim and lowercase for consistent storage and lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Prisma `where` clause for case-insensitive email match. */
export function emailEqualsWhere(email: string) {
  return {
    email: { equals: normalizeEmail(email), mode: 'insensitive' as const },
  };
}
