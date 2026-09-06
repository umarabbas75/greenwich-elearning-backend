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
exports.ForumCategoryService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const forum_policy_1 = require("./forum-policy");
const CATEGORY_SELECT = {
    id: true,
    name: true,
    slug: true,
    description: true,
    icon: true,
    sortOrder: true,
    isActive: true,
    courseScope: true,
    studentCreatePolicy: true,
    notifyOnCreate: true,
    allowAcceptedAnswer: true,
    allowVotes: true,
    allowMentions: true,
    tagPolicy: true,
    allowAttachments: true,
    createdAt: true,
    updatedAt: true,
};
let ForumCategoryService = class ForumCategoryService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(user, includeInactive) {
        const showInactive = includeInactive === true && (0, forum_policy_1.isAdminRole)(user.role);
        const categories = await this.prisma.forumCategory.findMany({
            where: showInactive ? undefined : { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: CATEGORY_SELECT,
        });
        const ids = categories.map((c) => c.id);
        const counts = ids.length === 0
            ? []
            : await this.prisma.forumThread.groupBy({
                by: ['categoryId'],
                _count: { _all: true },
                _max: { lastActivityAt: true },
                where: {
                    categoryId: { in: ids },
                    ...(user.role === client_1.Role.user
                        ? {
                            status: 'active',
                            OR: [
                                { courseId: null },
                                {
                                    course: {
                                        users: { some: { userId: user.id, isActive: true } },
                                    },
                                },
                            ],
                        }
                        : {}),
                },
            });
        const byId = new Map(counts.map((row) => [
            row.categoryId,
            {
                threadCount: row._count._all,
                lastActivityAt: row._max.lastActivityAt,
            },
        ]));
        return {
            message: 'Successfully fetched forum categories',
            statusCode: 200,
            data: categories.map((c) => ({
                ...c,
                threadCount: byId.get(c.id)?.threadCount ?? 0,
                lastActivityAt: byId.get(c.id)?.lastActivityAt ?? null,
            })),
        };
    }
    async create(user, body) {
        this.assertAdmin(user);
        const name = String(body?.name ?? '').trim();
        if (!name)
            throw this.fail('name is required');
        const slug = body?.slug
            ? (0, forum_policy_1.slugifyCategoryName)(String(body.slug))
            : (0, forum_policy_1.slugifyCategoryName)(name);
        try {
            const created = await this.prisma.forumCategory.create({
                data: {
                    name,
                    slug,
                    description: body?.description ?? null,
                    icon: body?.icon ?? null,
                    sortOrder: Number.isFinite(Number(body?.sortOrder))
                        ? Number(body.sortOrder)
                        : 99,
                    isActive: body?.isActive !== false,
                    courseScope: this.parseEnum(client_1.ForumCourseScope, body?.courseScope, client_1.ForumCourseScope.OPTIONAL),
                    studentCreatePolicy: this.parseEnum(client_1.ForumStudentCreatePolicy, body?.studentCreatePolicy, client_1.ForumStudentCreatePolicy.ALLOWED),
                    notifyOnCreate: this.parseEnum(client_1.ForumNotifyOnCreate, body?.notifyOnCreate, client_1.ForumNotifyOnCreate.ADMIN_ONLY),
                    allowAcceptedAnswer: this.parseBool(body?.allowAcceptedAnswer, true),
                    allowVotes: this.parseBool(body?.allowVotes, true),
                    allowMentions: this.parseBool(body?.allowMentions, true),
                    tagPolicy: this.parseEnum(client_1.ForumTagPolicy, body?.tagPolicy, client_1.ForumTagPolicy.FREEFORM),
                    allowAttachments: this.parseBool(body?.allowAttachments, true),
                    createdByAdminId: user.id,
                },
                select: CATEGORY_SELECT,
            });
            return {
                message: 'Successfully created forum category',
                statusCode: 200,
                data: created,
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw this.fail('A category with this slug already exists');
            }
            throw this.wrap(error);
        }
    }
    async update(user, id, body) {
        this.assertAdmin(user);
        const existing = await this.prisma.forumCategory.findUnique({
            where: { id },
        });
        if (!existing)
            throw this.fail('Category not found');
        const data = {};
        if (body?.name != null)
            data.name = String(body.name).trim();
        if (body?.slug != null)
            data.slug = (0, forum_policy_1.slugifyCategoryName)(String(body.slug));
        if (body?.description !== undefined)
            data.description = body.description;
        if (body?.icon !== undefined)
            data.icon = body.icon;
        if (body?.sortOrder != null)
            data.sortOrder = Number(body.sortOrder);
        if (body?.isActive != null)
            data.isActive = Boolean(body.isActive);
        if (body?.courseScope != null) {
            data.courseScope = this.parseEnum(client_1.ForumCourseScope, body.courseScope, existing.courseScope);
        }
        if (body?.studentCreatePolicy != null) {
            data.studentCreatePolicy = this.parseEnum(client_1.ForumStudentCreatePolicy, body.studentCreatePolicy, existing.studentCreatePolicy);
        }
        if (body?.notifyOnCreate != null) {
            data.notifyOnCreate = this.parseEnum(client_1.ForumNotifyOnCreate, body.notifyOnCreate, existing.notifyOnCreate);
        }
        if (body?.allowAcceptedAnswer != null) {
            data.allowAcceptedAnswer = this.parseBool(body.allowAcceptedAnswer, existing.allowAcceptedAnswer);
        }
        if (body?.allowVotes != null) {
            data.allowVotes = this.parseBool(body.allowVotes, existing.allowVotes);
        }
        if (body?.allowMentions != null) {
            data.allowMentions = this.parseBool(body.allowMentions, existing.allowMentions);
        }
        if (body?.tagPolicy != null) {
            data.tagPolicy = this.parseEnum(client_1.ForumTagPolicy, body.tagPolicy, existing.tagPolicy);
        }
        if (body?.allowAttachments != null) {
            data.allowAttachments = this.parseBool(body.allowAttachments, existing.allowAttachments);
        }
        try {
            const updated = await this.prisma.forumCategory.update({
                where: { id },
                data,
                select: CATEGORY_SELECT,
            });
            return {
                message: 'Successfully updated forum category',
                statusCode: 200,
                data: updated,
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw this.fail('A category with this slug already exists');
            }
            throw this.wrap(error);
        }
    }
    async remove(user, id) {
        this.assertAdmin(user);
        const existing = await this.prisma.forumCategory.findUnique({
            where: { id },
            include: { _count: { select: { threads: true } } },
        });
        if (!existing)
            throw this.fail('Category not found');
        if (existing._count.threads > 0) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'category_has_threads',
                threadCount: existing._count.threads,
                message: 'Move or uncategorize threads before deleting this category. You can also deactivate it instead.',
            }, common_1.HttpStatus.CONFLICT);
        }
        await this.prisma.forumCategory.delete({ where: { id } });
        return {
            message: 'Successfully deleted forum category',
            statusCode: 200,
            data: {},
        };
    }
    async moveThreads(user, fromId, toCategoryId) {
        this.assertAdmin(user);
        const source = await this.prisma.forumCategory.findUnique({
            where: { id: fromId },
        });
        if (!source)
            throw this.fail('Category not found');
        if (toCategoryId) {
            const target = await this.prisma.forumCategory.findUnique({
                where: { id: toCategoryId },
            });
            if (!target)
                throw this.fail('Target category not found');
        }
        const result = await this.prisma.forumThread.updateMany({
            where: { categoryId: fromId },
            data: { categoryId: toCategoryId },
        });
        return {
            message: 'Successfully moved forum threads',
            statusCode: 200,
            data: { moved: result.count, toCategoryId },
        };
    }
    parseBool(value, fallback) {
        if (value === true || value === 'true' || value === 1 || value === '1') {
            return true;
        }
        if (value === false || value === 'false' || value === 0 || value === '0') {
            return false;
        }
        return fallback;
    }
    parseEnum(enumObj, value, fallback) {
        if (typeof value === 'string' && Object.values(enumObj).includes(value)) {
            return value;
        }
        return fallback;
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
exports.ForumCategoryService = ForumCategoryService;
exports.ForumCategoryService = ForumCategoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ForumCategoryService);
//# sourceMappingURL=forum-category.service.js.map