import { ResponseDto, LoginDto } from '../dto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthService {
    private jwt;
    private config;
    private prisma;
    constructor(jwt: JwtService, config: ConfigService, prisma: PrismaService);
    loginUser(body: LoginDto): Promise<ResponseDto>;
    signToken(userId: string, email: string): Promise<string>;
}
