import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/** Reads optional registration-form photo URL from stored form metadata. */
export function extractUserPhotoFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>).userPhoto;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function userHasGlobalPhoto(photo: string | null | undefined): boolean {
  return Boolean(photo?.trim());
}

/**
 * When a learner submits a course form with `userPhoto` in metadata, copy it
 * to `users.photo` if they do not already have a global profile photo.
 */
export async function promoteFormPhotoToUserIfMissing(
  prisma: Db,
  userId: string,
  metadata: unknown,
): Promise<{ updated: boolean; photoUrl: string | null }> {
  const photoUrl = extractUserPhotoFromMetadata(metadata);
  if (!photoUrl) {
    return { updated: false, photoUrl: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { photo: true },
  });
  if (!user || userHasGlobalPhoto(user.photo)) {
    return { updated: false, photoUrl: null };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { photo: photoUrl },
  });

  return { updated: true, photoUrl };
}
