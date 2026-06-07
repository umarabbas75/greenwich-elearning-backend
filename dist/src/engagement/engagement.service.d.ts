import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
export interface SweepSummary {
    neverStarted: {
        candidates: number;
        notified: number;
        emailed: number;
    };
    stalled: {
        candidates: number;
        notified: number;
        emailed: number;
    };
    ranAt: string;
}
export declare class EngagementService {
    private readonly prisma;
    private readonly mail;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, mail: MailService, config: ConfigService);
    private num;
    private appBaseUrl;
    private courseUrl;
    runSweep(now?: Date): Promise<SweepSummary>;
    private static readonly ACTIVITY_CTE;
    private findNeverStarted;
    private findStalled;
    private dispatch;
    private sendEmails;
    private freshlyInsertedKeys;
}
