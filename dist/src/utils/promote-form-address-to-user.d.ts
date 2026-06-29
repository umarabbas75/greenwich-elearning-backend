import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type Db = PrismaService | Prisma.TransactionClient;
export declare function extractUserAddressFromMetadata(metadata: unknown): string | null;
export declare function userHasGlobalAddress(address: string | null | undefined): boolean;
export declare function promoteFormAddressToUserIfMissing(prisma: Db, userId: string, metadata: unknown): Promise<{
    updated: boolean;
    address: string | null;
}>;
export {};
