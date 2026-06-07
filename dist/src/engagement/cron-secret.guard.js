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
var CronSecretGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronSecretGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let CronSecretGuard = CronSecretGuard_1 = class CronSecretGuard {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(CronSecretGuard_1.name);
    }
    canActivate(context) {
        const expected = this.config.get('CRON_SECRET');
        if (!expected) {
            this.logger.error('CRON_SECRET is not configured — denying cron request.');
            throw new common_1.UnauthorizedException('Cron secret not configured');
        }
        const req = context.switchToHttp().getRequest();
        const provided = this.extractSecret(req);
        if (!provided || provided !== expected) {
            throw new common_1.UnauthorizedException('Invalid cron secret');
        }
        return true;
    }
    extractSecret(req) {
        const auth = req.headers['authorization'];
        if (typeof auth === 'string') {
            const [scheme, token] = auth.split(' ');
            if (scheme?.toLowerCase() === 'bearer' && token)
                return token;
        }
        const custom = req.headers['x-cron-secret'];
        if (typeof custom === 'string' && custom)
            return custom;
        return null;
    }
};
exports.CronSecretGuard = CronSecretGuard;
exports.CronSecretGuard = CronSecretGuard = CronSecretGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CronSecretGuard);
//# sourceMappingURL=cron-secret.guard.js.map