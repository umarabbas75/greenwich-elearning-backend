import { NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
interface AuthenticatedRequest extends Request {
    user?: any;
}
export declare class JwtMiddleware implements NestMiddleware {
    private config;
    private jwtService;
    constructor(config: ConfigService, jwtService: JwtService);
    use(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>>>;
}
export {};
