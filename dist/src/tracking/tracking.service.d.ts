import { PrismaService } from '../prisma/prisma.service';
export declare class TrackingService {
    private readonly prisma;
    static readonly MIN_INTERVAL = 5;
    static readonly MAX_INTERVAL = 60;
    static readonly CAP_FACTOR = 3;
    static readonly GRACE_FACTOR = 1.5;
    static readonly ABSOLUTE_CAP = 90;
    constructor(prisma: PrismaService);
    heartbeat(userId: string, sectionId: string, clientActiveSeconds?: number | null, clientIntervalSeconds?: number | null): Promise<{
        message: string;
        statusCode: number;
        data: {
            totalSeconds: number;
        };
    }>;
    private utcDay;
    private accrueDailyTime;
    getLoginHistory(userId: string, limit?: number): Promise<{
        message: string;
        statusCode: number;
        data: {
            device: string;
            browser: string;
            os: string;
            deviceType: "mobile" | "tablet" | "desktop";
            id: string;
            createdAt: Date;
            ipAddress: string;
            userAgent: string;
        }[];
    }>;
    getUserCourseTimeSpent(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseId: string;
            totalSeconds: number;
            modules: {
                moduleId: string | null;
                title: string;
                totalSeconds: number;
                chapters: {
                    chapterId: string;
                    title: string;
                    totalSeconds: number;
                    sections: {
                        sectionId: string;
                        title: string;
                        totalSeconds: number;
                    }[];
                }[];
            }[];
            perSection: {
                title: string;
                moduleId: string;
                chapterId: string;
                sectionId: string;
                totalSeconds: number;
            }[];
        };
    }>;
    private heartbeatResult;
}
