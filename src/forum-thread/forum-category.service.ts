import {
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  ForumCourseScope,
  ForumNotifyOnCreate,
  ForumStudentCreatePolicy,
  ForumTagPolicy,
  Prisma,
  Role,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminRole, slugifyCategoryName } from './forum-policy';

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
} satisfies Prisma.ForumCategorySelect;

@Injectable()
export class ForumCategoryService {
  constructor(private prisma: PrismaService) {}

  async list(user: User, includeInactive?: boolean) {
    const showInactive = includeInactive === true && isAdminRole(user.role);
    const categories = await this.prisma.forumCategory.findMany({
      where: showInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    });

    const ids = categories.map((c) => c.id);
    const counts =
      ids.length === 0
        ? []
        : await this.prisma.forumThread.groupBy({
            by: ['categoryId'],
            _count: { _all: true },
            _max: { lastActivityAt: true },
            where: {
              categoryId: { in: ids },
              ...(user.role === Role.user
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
    const byId = new Map(
      counts.map((row) => [
        row.categoryId,
        {
          threadCount: row._count._all,
          lastActivityAt: row._max.lastActivityAt,
        },
      ]),
    );

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

  async create(user: User, body: any) {
    this.assertAdmin(user);
    const name = String(body?.name ?? '').trim();
    if (!name) throw this.fail('name is required');

    const slug = body?.slug
      ? slugifyCategoryName(String(body.slug))
      : slugifyCategoryName(name);

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
          courseScope: this.parseEnum(
            ForumCourseScope,
            body?.courseScope,
            ForumCourseScope.OPTIONAL,
          ),
          studentCreatePolicy: this.parseEnum(
            ForumStudentCreatePolicy,
            body?.studentCreatePolicy,
            ForumStudentCreatePolicy.ALLOWED,
          ),
          notifyOnCreate: this.parseEnum(
            ForumNotifyOnCreate,
            body?.notifyOnCreate,
            ForumNotifyOnCreate.ADMIN_ONLY,
          ),
          allowAcceptedAnswer: this.parseBool(body?.allowAcceptedAnswer, true),
          allowVotes: this.parseBool(body?.allowVotes, true),
          allowMentions: this.parseBool(body?.allowMentions, true),
          tagPolicy: this.parseEnum(
            ForumTagPolicy,
            body?.tagPolicy,
            ForumTagPolicy.FREEFORM,
          ),
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.fail('A category with this slug already exists');
      }
      throw this.wrap(error);
    }
  }

  async update(user: User, id: string, body: any) {
    this.assertAdmin(user);
    const existing = await this.prisma.forumCategory.findUnique({
      where: { id },
    });
    if (!existing) throw this.fail('Category not found');

    const data: Prisma.ForumCategoryUpdateInput = {};
    if (body?.name != null) data.name = String(body.name).trim();
    if (body?.slug != null) data.slug = slugifyCategoryName(String(body.slug));
    if (body?.description !== undefined) data.description = body.description;
    if (body?.icon !== undefined) data.icon = body.icon;
    if (body?.sortOrder != null) data.sortOrder = Number(body.sortOrder);
    if (body?.isActive != null) data.isActive = Boolean(body.isActive);
    if (body?.courseScope != null) {
      data.courseScope = this.parseEnum(
        ForumCourseScope,
        body.courseScope,
        existing.courseScope,
      );
    }
    if (body?.studentCreatePolicy != null) {
      data.studentCreatePolicy = this.parseEnum(
        ForumStudentCreatePolicy,
        body.studentCreatePolicy,
        existing.studentCreatePolicy,
      );
    }
    if (body?.notifyOnCreate != null) {
      data.notifyOnCreate = this.parseEnum(
        ForumNotifyOnCreate,
        body.notifyOnCreate,
        existing.notifyOnCreate,
      );
    }
    if (body?.allowAcceptedAnswer != null) {
      data.allowAcceptedAnswer = this.parseBool(
        body.allowAcceptedAnswer,
        existing.allowAcceptedAnswer,
      );
    }
    if (body?.allowVotes != null) {
      data.allowVotes = this.parseBool(body.allowVotes, existing.allowVotes);
    }
    if (body?.allowMentions != null) {
      data.allowMentions = this.parseBool(
        body.allowMentions,
        existing.allowMentions,
      );
    }
    if (body?.tagPolicy != null) {
      data.tagPolicy = this.parseEnum(
        ForumTagPolicy,
        body.tagPolicy,
        existing.tagPolicy,
      );
    }
    if (body?.allowAttachments != null) {
      data.allowAttachments = this.parseBool(
        body.allowAttachments,
        existing.allowAttachments,
      );
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.fail('A category with this slug already exists');
      }
      throw this.wrap(error);
    }
  }

  async remove(user: User, id: string) {
    this.assertAdmin(user);
    const existing = await this.prisma.forumCategory.findUnique({
      where: { id },
      include: { _count: { select: { threads: true } } },
    });
    if (!existing) throw this.fail('Category not found');
    if (existing._count.threads > 0) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'category_has_threads',
          threadCount: existing._count.threads,
          message:
            'Move or uncategorize threads before deleting this category. You can also deactivate it instead.',
        },
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.forumCategory.delete({ where: { id } });
    return {
      message: 'Successfully deleted forum category',
      statusCode: 200,
      data: {},
    };
  }

  async moveThreads(user: User, fromId: string, toCategoryId: string | null) {
    this.assertAdmin(user);
    const source = await this.prisma.forumCategory.findUnique({
      where: { id: fromId },
    });
    if (!source) throw this.fail('Category not found');

    if (toCategoryId) {
      const target = await this.prisma.forumCategory.findUnique({
        where: { id: toCategoryId },
      });
      if (!target) throw this.fail('Target category not found');
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

  private parseBool(value: unknown, fallback: boolean): boolean {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === 0 || value === '0') {
      return false;
    }
    return fallback;
  }

  private parseEnum<T extends Record<string, string>>(
    enumObj: T,
    value: unknown,
    fallback: T[keyof T],
  ): T[keyof T] {
    if (typeof value === 'string' && Object.values(enumObj).includes(value)) {
      return value as T[keyof T];
    }
    return fallback;
  }

  private assertAdmin(user: User) {
    if (!isAdminRole(user.role)) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: 'Admin only' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private fail(error: string) {
    return new HttpException(
      { status: HttpStatus.FORBIDDEN, error },
      HttpStatus.FORBIDDEN,
    );
  }

  private wrap(error: unknown) {
    if (error instanceof HttpException) return error;
    const message =
      error instanceof Error ? error.message : 'Something went wrong';
    return new HttpException(
      { status: HttpStatus.FORBIDDEN, error: message },
      HttpStatus.FORBIDDEN,
    );
  }
}
