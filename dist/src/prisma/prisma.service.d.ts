import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService extends PrismaClient {
    private static readonly retryLogger;
    constructor(config: ConfigService);
}
