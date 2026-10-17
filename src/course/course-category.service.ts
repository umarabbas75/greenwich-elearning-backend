import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const courseCategorySelect = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.CourseCategorySelect;

function slugifyCategoryName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'category';
}

@Injectable()
export class CourseCategoryService {
  constructor(private prisma: PrismaService) {}

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

  async create(body: {
    name: string;
    description?: string;
    sortOrder?: number;
    slug?: string;
  }) {
    const name = body.name.trim();
    if (!name) throw this.fail('name is required');

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
    } catch (error) {
      throw this.wrapUnique(error);
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      description?: string | null;
      sortOrder?: number;
      slug?: string;
    },
  ) {
    const existing = await this.prisma.courseCategory.findUnique({
      where: { id },
    });
    if (!existing) throw this.missing('Category not found');

    const data: Prisma.CourseCategoryUpdateInput = {};
    if (body.name != null) {
      const name = body.name.trim();
      if (!name) throw this.fail('name is required');
      data.name = name;
      if (body.slug == null) data.slug = slugifyCategoryName(name);
    }
    if (body.slug != null) data.slug = this.resolveSlug(body.slug, existing.name);
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
    } catch (error) {
      throw this.wrapUnique(error);
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.courseCategory.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!existing) throw this.missing('Category not found');
    if (existing._count.courses > 0) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: `Move or unassign ${existing._count.courses} course(s) before deleting this category`,
        },
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.courseCategory.delete({ where: { id } });
    return {
      message: 'Successfully deleted course category',
      statusCode: 200,
      data: { id },
    };
  }

  async assign(courseId: string, categoryId: string | null) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) throw this.missing('Course not found');

    if (categoryId) {
      const category = await this.prisma.courseCategory.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!category) throw this.missing('Category not found');
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { categoryId },
      select: {
        id: true,
        title: true,
        categoryId: true,
        category: { select: courseCategorySelect },
      },
    });

    return {
      message: categoryId
        ? 'Successfully assigned course category'
        : 'Successfully cleared course category',
      statusCode: 200,
      data: updated,
    };
  }

  private async resolveSortOrder(sortOrder?: number) {
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

  private resolveSlug(slug: string | undefined, name: string) {
    const value = slugifyCategoryName(slug?.trim() ? slug : name);
    if (!value) throw this.fail('slug is required');
    return value;
  }

  private optionalText(value: string | null | undefined) {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private fail(error: string) {
    return new HttpException(
      { status: HttpStatus.BAD_REQUEST, error },
      HttpStatus.BAD_REQUEST,
    );
  }

  private missing(error: string) {
    return new HttpException(
      { status: HttpStatus.NOT_FOUND, error },
      HttpStatus.NOT_FOUND,
    );
  }

  private wrapUnique(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'A category with this name or slug already exists',
        },
        HttpStatus.CONFLICT,
      );
    }
    const message =
      error instanceof Error ? error.message : 'Something went wrong';
    return new HttpException(
      { status: HttpStatus.BAD_REQUEST, error: message },
      HttpStatus.BAD_REQUEST,
    );
  }
}
