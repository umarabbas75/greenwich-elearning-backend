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
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const with_db_retry_1 = require("../utils/with-db-retry");
const globalForPrisma = globalThis;
const READ_ACTIONS = new Set([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
]);
let PrismaService = PrismaService_1 = class PrismaService extends client_1.PrismaClient {
    constructor(config) {
        const url = config.get('DATABASE_URL');
        const isTest = process.env.NODE_ENV === 'test';
        if (globalForPrisma.nestPrisma && !isTest) {
            return globalForPrisma.nestPrisma;
        }
        super({
            datasources: {
                db: {
                    url,
                },
            },
        });
        if (!isTest) {
            globalForPrisma.nestPrisma = this;
        }
        this.$use(async (params, next) => {
            const mode = READ_ACTIONS.has(params.action) ? 'read' : 'write';
            return (0, with_db_retry_1.withDbRetry)(() => next(params), {
                mode,
                onRetry: ({ attempt, maxAttempts, code }) => {
                    PrismaService_1.retryLogger.warn(`DB transient error, retrying (${attempt}/${maxAttempts}) model=${String(params.model)} action=${params.action} code=${code ?? 'n/a'}`);
                },
            });
        });
    }
};
exports.PrismaService = PrismaService;
PrismaService.retryLogger = new common_1.Logger('PrismaRetry');
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map