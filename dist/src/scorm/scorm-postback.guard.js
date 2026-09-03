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
var ScormPostbackGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqual = exports.parseBasicAuth = exports.ScormPostbackGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const constant_time_equal_1 = require("../utils/constant-time-equal");
let ScormPostbackGuard = ScormPostbackGuard_1 = class ScormPostbackGuard {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(ScormPostbackGuard_1.name);
    }
    canActivate(context) {
        const expectedUser = this.config.get('SCORM_POSTBACK_AUTH_USER');
        const expectedPass = this.config.get('SCORM_POSTBACK_AUTH_PASSWORD');
        if (!expectedUser || !expectedPass) {
            this.logger.error('SCORM_POSTBACK_AUTH_USER/PASSWORD are not configured — denying postback.');
            throw new common_1.UnauthorizedException('Postback auth is not configured');
        }
        const req = context.switchToHttp().getRequest();
        const parsed = parseBasicAuth(req.headers?.authorization);
        if (!parsed) {
            throw new common_1.UnauthorizedException('Invalid postback credentials');
        }
        if (!(0, constant_time_equal_1.constantTimeEqual)(parsed.user, expectedUser) ||
            !(0, constant_time_equal_1.constantTimeEqual)(parsed.password, expectedPass)) {
            throw new common_1.UnauthorizedException('Invalid postback credentials');
        }
        return true;
    }
};
exports.ScormPostbackGuard = ScormPostbackGuard;
exports.ScormPostbackGuard = ScormPostbackGuard = ScormPostbackGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ScormPostbackGuard);
function parseBasicAuth(header) {
    if (typeof header !== 'string')
        return null;
    const [scheme, token] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'basic' || !token)
        return null;
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon < 0)
            return null;
        return {
            user: decoded.slice(0, colon),
            password: decoded.slice(colon + 1),
        };
    }
    catch {
        return null;
    }
}
exports.parseBasicAuth = parseBasicAuth;
exports.safeEqual = constant_time_equal_1.constantTimeEqual;
//# sourceMappingURL=scorm-postback.guard.js.map