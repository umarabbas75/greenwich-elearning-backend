"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtCombineStrategy = exports.JwtUserStrategy = exports.JwtAdminStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
let JwtAdminStrategy = class JwtAdminStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy, 'jwt') {
    constructor(config, prisma) {
        const jwt_secret = config.get('JWT_SECRET');
        const jwt_expiry = config.get('JWT_EXPIRY');
        if (!jwt_secret || !jwt_expiry) {
            throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
        }
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: jwt_secret,
        });
        this.prisma = prisma;
    }
    async validate(payload) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: payload.sub,
            },
        });
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: 'UnAuthorized',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        if (user.role !== 'admin') {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: 'Forbidden',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        delete user.password;
        return user;
    }
};
exports.JwtAdminStrategy = JwtAdminStrategy;
exports.JwtAdminStrategy = JwtAdminStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], JwtAdminStrategy);
let JwtUserStrategy = class JwtUserStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy, 'uJwt') {
    constructor(config, prisma) {
        const jwt_secret = config.get('JWT_SECRET');
        const jwt_expiry = config.get('JWT_EXPIRY');
        if (!jwt_secret || !jwt_expiry) {
            throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
        }
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: jwt_secret,
        });
        this.prisma = prisma;
    }
    async validate(payload) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: payload.sub,
            },
        });
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: 'User not found',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        if (user.role !== 'user') {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: 'Forbidden',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        delete user.password;
        return user;
    }
};
exports.JwtUserStrategy = JwtUserStrategy;
exports.JwtUserStrategy = JwtUserStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], JwtUserStrategy);
let JwtCombineStrategy = class JwtCombineStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy, 'cJwt') {
    constructor(config, prisma) {
        const jwt_secret = config.get('JWT_SECRET');
        const jwt_expiry = config.get('JWT_EXPIRY');
        if (!jwt_secret || !jwt_expiry) {
            throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
        }
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: jwt_secret,
        });
        this.prisma = prisma;
    }
    async validate(payload) {
        try {
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp <= now) {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Token expiredss',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            const user = await this.prisma.user.findUnique({
                where: {
                    id: payload.sub,
                },
            });
            if (!user) {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'User not found',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            if (user.role !== 'user' && user.role !== 'admin') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Forbidden',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            delete user.password;
            return user;
        }
        catch (error) {
            console.log({ error });
        }
    }
};
exports.JwtCombineStrategy = JwtCombineStrategy;
exports.JwtCombineStrategy = JwtCombineStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], JwtCombineStrategy);
//# sourceMappingURL=jwt.strategy.js.map