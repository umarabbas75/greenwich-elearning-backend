import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService extends PrismaClient {
    [x: string]: any;
    constructor(config: ConfigService);
}
