import { ResponseDto, LoginDto, ForceChangePasswordDto } from '../dto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthService {
    private jwt;
    private config;
    private prisma;
    private static readonly logger;
    constructor(jwt: JwtService, config: ConfigService, prisma: PrismaService);
    loginUser(body: LoginDto, context?: {
        ipAddress?: string | null;
        userAgent?: string | null;
    }): Promise<ResponseDto>;
    forceChangePassword(body: ForceChangePasswordDto): Promise<ResponseDto>;
    signToken(userId: string, email: string): Promise<string>;
    private recordLoginEvent;
}
