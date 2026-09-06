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
exports.ForumTagService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const forum_policy_1 = require("./forum-policy");
const TAG_SELECT = {
    id: true,
    name: true,
    slug: true,
};
let ForumTagService = class ForumTagService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(q) {
        const term = q?.trim();
        const tags = await this.prisma.forumTag.findMany({
            where: term
                ? { name: { contains: term, mode: 'insensitive' } }
                : undefined,
            orderBy: { name: 'asc' },
            take: 20,
            select: TAG_SELECT,
        });
        return {
            message: 'Successfully fetched forum tags',
            statusCode: 200,
            data: tags,
        };
    }
    async create(user, body) {
        const name = String(body?.name ?? '').trim();
        if (!name)
            throw this.fail('name is required');
        const slug = (0, forum_policy_1.slugifyCategoryName)(name);
        try {
            const created = await this.prisma.forumTag.create({
                data: {
                    name,
                    slug,
                    createdByAdminId: (0, forum_policy_1.isAdminRole)(user.role) ? user.id : null,
                },
                select: TAG_SELECT,
            });
            return {
                message: 'Successfully created forum tag',
                statusCode: 200,
                data: created,
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                const existing = await this.prisma.forumTag.findUnique({
                    where: { slug },
                    select: TAG_SELECT,
                });
                if (existing) {
                    return {
                        message: 'Successfully fetched forum tag',
                        statusCode: 200,
                        data: existing,
                    };
                }
                throw this.fail('A tag with this name already exists');
            }
            throw this.wrap(error);
        }
    }
    async update(user, id, body) {
        this.assertAdmin(user);
        const name = String(body?.name ?? '').trim();
        if (!name)
            throw this.fail('name is required');
        try {
            const updated = await this.prisma.forumTag.update({
                where: { id },
                data: { name, slug: (0, forum_policy_1.slugifyCategoryName)(name) },
                select: TAG_SELECT,
            });
            return {
                message: 'Successfully updated forum tag',
                statusCode: 200,
                data: updated,
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2025') {
                throw this.fail('Tag not found');
            }
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw this.fail('A tag with this name already exists');
            }
            throw this.wrap(error);
        }
    }
    async remove(user, id) {
        this.assertAdmin(user);
        try {
            await this.prisma.forumTag.delete({ where: { id } });
            return {
                message: 'Successfully deleted forum tag',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2025') {
                throw this.fail('Tag not found');
            }
            throw this.wrap(error);
        }
    }
    assertAdmin(user) {
        if (!(0, forum_policy_1.isAdminRole)(user.role)) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: 'Admin only' }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    fail(error) {
        return new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error }, common_1.HttpStatus.FORBIDDEN);
    }
    wrap(error) {
        if (error instanceof common_1.HttpException)
            return error;
        const message = error instanceof Error ? error.message : 'Something went wrong';
        return new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: message }, common_1.HttpStatus.FORBIDDEN);
    }
};
exports.ForumTagService = ForumTagService;
exports.ForumTagService = ForumTagService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ForumTagService);
//# sourceMappingURL=forum-tag.service.js.map