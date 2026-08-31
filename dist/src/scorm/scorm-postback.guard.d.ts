import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class ScormPostbackGuard implements CanActivate {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    canActivate(context: ExecutionContext): boolean;
}
export declare function parseBasicAuth(header: unknown): {
    user: string;
    password: string;
} | null;
export declare function safeEqual(provided: string, expected: string): boolean;
