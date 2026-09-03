import { timingSafeEqual } from 'crypto';

/** Length-check before timingSafeEqual so unequal-length secrets do not throw. */
export function constantTimeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
