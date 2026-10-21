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
exports.CourseCategoryService = exports.courseCategorySelect = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const admin_audit_1 = require("../utils/admin-audit");
exports.courseCategorySelect = {
    id: true,
    name: true,
    slug: true,
};
function slugifyCategoryName(name) {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || 'category';
}
let CourseCategoryService = class CourseCategoryService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list() {
        const categories = await this.prisma.courseCategory.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { courses: true } } },
        });
        return {
            message: 'Successfully fetched course categories',
            statusCode: 200,
            data: categories.map(({ _count, ...category }) => ({
                ...category,
                courseCount: _count.courses,
            })),
        };
    }
    async create(body) {
        const name = body.name.trim();
        if (!name)
            throw this.fail('name is required');
        const sortOrder = await this.resolveSortOrder(body.sortOrder);
        try {
            const created = await this.prisma.courseCategory.create({
                data: {
                    name,
                    slug: this.resolveSlug(body.slug, name),
                    description: this.optionalText(body.description),
                    sortOrder,
                },
            });
            return {
                message: 'Successfully created course category',
                statusCode: 200,
                data: { ...created, courseCount: 0 },
            };
        }
        catch (error) {
            throw this.wrapUnique(error);
        }
    }
    async update(id, body) {
        const existing = await this.prisma.courseCategory.findUnique({
            where: { id },
        });
        if (!existing)
            throw this.missing('Category not found');
        const data = {};
        if (body.name != null) {
            const name = body.name.trim();
            if (!name)
                throw this.fail('name is required');
            data.name = name;
            if (body.slug == null)
                data.slug = slugifyCategoryName(name);
        }
        if (body.slug != null)
            data.slug = this.resolveSlug(body.slug, existing.name);
        if (body.description !== undefined) {
            data.description = this.optionalText(body.description);
        }
        if (body.sortOrder != null) {
            if (!Number.isInteger(body.sortOrder)) {
                throw this.fail('sortOrder must be an integer');
            }
            data.sortOrder = body.sortOrder;
        }
        try {
            const updated = await this.prisma.courseCategory.update({
                where: { id },
                data,
                include: { _count: { select: { courses: true } } },
            });
            const { _count, ...category } = updated;
            return {
                message: 'Successfully updated course category',
                statusCode: 200,
                data: { ...category, courseCount: _count.courses },
            };
        }
        catch (error) {
            throw this.wrapUnique(error);
        }
    }
    async remove(id) {
        const existing = await this.prisma.courseCategory.findUnique({
            where: { id },
            include: { _count: { select: { courses: true } } },
        });
        if (!existing)
            throw this.missing('Category not found');
        if (existing._count.courses > 0) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: `Move or unassign ${existing._count.courses} course(s) before deleting this category`,
            }, common_1.HttpStatus.CONFLICT);
        }
        await this.prisma.courseCategory.delete({ where: { id } });
        return {
            message: 'Successfully deleted course category',
            statusCode: 200,
            data: { id },
        };
    }
    async assign(courseId, categoryId, adminId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, categoryId: true },
        });
        if (!course)
            throw this.missing('Course not found');
        if (categoryId) {
            const category = await this.prisma.courseCategory.findUnique({
                where: { id: categoryId },
                select: { id: true },
            });
            if (!category)
                throw this.missing('Category not found');
        }
        const updated = await this.prisma.course.update({
            where: { id: courseId },
            data: { categoryId },
            select: {
                id: true,
                title: true,
                categoryId: true,
                category: { select: exports.courseCategorySelect },
            },
        });
        if (adminId && course.categoryId !== categoryId) {
            await (0, admin_audit_1.writeAdminAudit)(this.prisma, {
                adminId,
                action: 'ASSIGN_COURSE_CATEGORY',
                targetType: 'Course',
                targetId: courseId,
                courseId,
                metadata: { from: course.categoryId, to: categoryId },
            });
        }
        return {
            message: categoryId
                ? 'Successfully assigned course category'
                : 'Successfully cleared course category',
            statusCode: 200,
            data: updated,
        };
    }
    async resolveSortOrder(sortOrder) {
        if (sortOrder == null) {
            const latest = await this.prisma.courseCategory.findFirst({
                orderBy: { sortOrder: 'desc' },
                select: { sortOrder: true },
            });
            return (latest?.sortOrder ?? 0) + 1;
        }
        if (!Number.isInteger(sortOrder)) {
            throw this.fail('sortOrder must be an integer');
        }
        return sortOrder;
    }
    resolveSlug(slug, name) {
        const value = slugifyCategoryName(slug?.trim() ? slug : name);
        if (!value)
            throw this.fail('slug is required');
        return value;
    }
    optionalText(value) {
        if (value == null)
            return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    fail(error) {
        return new common_1.HttpException({ status: common_1.HttpStatus.BAD_REQUEST, error }, common_1.HttpStatus.BAD_REQUEST);
    }
    missing(error) {
        return new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error }, common_1.HttpStatus.NOT_FOUND);
    }
    wrapUnique(error) {
        if (error instanceof common_1.HttpException)
            return error;
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002') {
            return new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'A category with this name or slug already exists',
            }, common_1.HttpStatus.CONFLICT);
        }
        const message = error instanceof Error ? error.message : 'Something went wrong';
        return new common_1.HttpException({ status: common_1.HttpStatus.BAD_REQUEST, error: message }, common_1.HttpStatus.BAD_REQUEST);
    }
};
exports.CourseCategoryService = CourseCategoryService;
exports.CourseCategoryService = CourseCategoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseCategoryService);
//# sourceMappingURL=course-category.service.js.map