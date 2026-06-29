import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

const ADDRESS_PART_KEYS = [
  'houseStreetNumber',
  'mainAddress',
  'city',
  'country',
] as const;

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reads optional registration-form address from stored form metadata. */
export function extractUserAddressFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const obj = metadata as Record<string, unknown>;

  const direct = trimString(obj.address);
  if (direct) {
    return direct;
  }

  const parts: string[] = [];
  for (const key of ADDRESS_PART_KEYS) {
    const value = trimString(obj[key]);
    if (!value) {
      continue;
    }
    const duplicate = parts.some(
      (part) =>
        part.toLowerCase() === value.toLowerCase() ||
        part.toLowerCase().includes(value.toLowerCase()) ||
        value.toLowerCase().includes(part.toLowerCase()),
    );
    if (!duplicate) {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

export function userHasGlobalAddress(
  address: string | null | undefined,
): boolean {
  return Boolean(address?.trim());
}

/**
 * When a learner submits a course form with address fields in metadata, copy
 * the composed address to `users.address` if they do not already have one.
 */
export async function promoteFormAddressToUserIfMissing(
  prisma: Db,
  userId: string,
  metadata: unknown,
): Promise<{ updated: boolean; address: string | null }> {
  const address = extractUserAddressFromMetadata(metadata);
  if (!address) {
    return { updated: false, address: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { address: true },
  });
  if (!user || userHasGlobalAddress(user.address)) {
    return { updated: false, address: null };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { address },
  });

  return { updated: true, address };
}
