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
exports.JwtMiddleware = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
let JwtMiddleware = class JwtMiddleware {
    constructor(config, jwtService) {
        this.config = config;
        this.jwtService = jwtService;
    }
    async use(req, res, next) {
        const token = req.headers.authorization?.split(' ')[1];
        console.log({ token });
        if (!token) {
            return res.status(401).json({ message: 'Unauthorizedsss' });
        }
        try {
            const payload = await this.jwtService.verify(token, {
                secret: this.config.get('JWT_SECRET'),
                ignoreExpiration: true,
            });
            console.log('token payload', { payload });
            next();
        }
        catch (error) {
            console.log({ error });
            return res.status(401).json({ message: 'Unauthorizedssss' });
        }
    }
};
exports.JwtMiddleware = JwtMiddleware;
exports.JwtMiddleware = JwtMiddleware = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        jwt_1.JwtService])
], JwtMiddleware);
//# sourceMappingURL=jwt.middleware.js.map