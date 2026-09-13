import { User } from '@prisma/client';
import { TrackingHeartbeatDto, SectionAttemptDto } from '../dto';
import { TrackingService } from './tracking.service';
export declare class TrackingController {
    private readonly tracking;
    constructor(tracking: TrackingService);
    private assertCanRead;
    heartbeat(body: TrackingHeartbeatDto, user: {
        id: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            totalSeconds: number;
            creditedSeconds: number;
            frozen: boolean;
        };
    }>;
    sectionAttempt(body: SectionAttemptDto, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            totalAttempts: number;
            lastAttemptAt: Date;
        };
    }>;
    getLoginHistory(requester: User, userId: string, limit?: string): Promise<{
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
    getMyLoginHistory(user: User, limit?: string): Promise<{
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
    getUserCourseTimeSpent(requester: User, userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseId: string;
            totalSeconds: number;
            modules: {
                moduleId: string;
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
                chapterId: string;
                moduleId: string;
                sectionId: string;
                totalSeconds: number;
            }[];
        };
    }>;
}
