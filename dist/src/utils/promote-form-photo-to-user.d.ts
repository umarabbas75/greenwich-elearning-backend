import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type Db = PrismaService | Prisma.TransactionClient;
export declare function extractUserPhotoFromMetadata(metadata: unknown): string | null;
export declare function userHasGlobalPhoto(photo: string | null | undefined): boolean;
export declare function promoteFormPhotoToUserIfMissing(prisma: Db, userId: string, metadata: unknown): Promise<{
    updated: boolean;
    photoUrl: string | null;
}>;
export {};
