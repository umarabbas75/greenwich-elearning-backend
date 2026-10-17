import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CourseCategoryService } from './course-category.service';

describe('CourseCategoryService', () => {
  const category = {
    id: 'cat-1',
    name: 'NEBOSH',
    slug: 'nebosh',
    description: null,
    sortOrder: 1,
    createdAt: new Date('2026-10-18T00:00:00Z'),
    updatedAt: new Date('2026-10-18T00:00:00Z'),
  };

  function build(prisma: Record<string, any>) {
    return new CourseCategoryService(prisma as any);
  }

  it('creates a category and derives the slug from the name', async () => {
    const prisma = {
      courseCategory: {
        findFirst: jest.fn().mockResolvedValue({ sortOrder: 4 }),
        create: jest.fn().mockImplementation(({ data }) => ({
          ...category,
          ...data,
          id: 'cat-new',
        })),
      },
    };
    const result = await build(prisma).create({ name: '  Highfield  ' });

    expect(prisma.courseCategory.create).toHaveBeenCalledWith({
      data: {
        name: 'Highfield',
        slug: 'highfield',
        description: null,
        sortOrder: 5,
      },
    });
    expect(result.data).toMatchObject({
      name: 'Highfield',
      slug: 'highfield',
      courseCount: 0,
    });
  });

  it('renames a category and refreshes the slug', async () => {
    const prisma = {
      courseCategory: {
        findUnique: jest.fn().mockResolvedValue(category),
        update: jest.fn().mockResolvedValue({
          ...category,
          name: 'NEBOSH Awards',
          slug: 'nebosh-awards',
          _count: { courses: 2 },
        }),
      },
    };

    const result = await build(prisma).update('cat-1', {
      name: 'NEBOSH Awards',
    });

    expect(prisma.courseCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'NEBOSH Awards', slug: 'nebosh-awards' },
      }),
    );
    expect(result.data).toMatchObject({
      name: 'NEBOSH Awards',
      courseCount: 2,
    });
  });

  it('refuses to delete a category that still has courses', async () => {
    const prisma = {
      courseCategory: {
        findUnique: jest.fn().mockResolvedValue({
          ...category,
          _count: { courses: 2 },
        }),
        delete: jest.fn(),
      },
    };

    await expect(build(prisma).remove('cat-1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.courseCategory.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty category', async () => {
    const prisma = {
      courseCategory: {
        findUnique: jest.fn().mockResolvedValue({
          ...category,
          _count: { courses: 0 },
        }),
        delete: jest.fn().mockResolvedValue(category),
      },
    };

    const result = await build(prisma).remove('cat-1');
    expect(result.data).toEqual({ id: 'cat-1' });
  });

  it('assigns a course to a category', async () => {
    const prisma = {
      course: {
        findUnique: jest.fn().mockResolvedValue({ id: 'course-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'course-1',
          title: 'NEBOSH Award',
          categoryId: 'cat-1',
          category,
        }),
      },
      courseCategory: {
        findUnique: jest.fn().mockResolvedValue(category),
      },
    };

    const result = await build(prisma).assign('course-1', 'cat-1');
    expect(prisma.course.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'course-1' },
        data: { categoryId: 'cat-1' },
      }),
    );
    expect(result.data).toMatchObject({ categoryId: 'cat-1' });
  });

  it('rejects an unknown category on assign', async () => {
    const prisma = {
      course: {
        findUnique: jest.fn().mockResolvedValue({ id: 'course-1' }),
        update: jest.fn(),
      },
      courseCategory: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    try {
      await build(prisma).assign('course-1', 'missing');
      throw new Error('expected assign to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(404);
    }
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('maps a duplicate name to a conflict', async () => {
    const prisma = {
      courseCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '5.9.1',
          }),
        ),
      },
    };

    try {
      await build(prisma).create({ name: 'NEBOSH' });
      throw new Error('expected create to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
    }
  });
});
