import { User } from '@prisma/client';
import { TrackingHeartbeatDto } from '../dto';
import { TrackingService } from './tracking.service';
export declare class TrackingController {
    private readonly tracking;
    constructor(tracking: TrackingService);
    heartbeat(body: TrackingHeartbeatDto, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            totalSeconds: number;
        };
    }>;
    getLoginHistory(userId: string, limit?: string): Promise<{
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
    getUserCourseTimeSpent(userId: string, courseId: string): Promise<{
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
                sectionId: string;
                moduleId: string;
                totalSeconds: number;
            }[];
        };
    }>;
}
