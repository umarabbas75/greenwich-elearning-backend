import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminRole, slugifyCategoryName } from './forum-policy';

const TAG_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.ForumTagSelect;

@Injectable()
export class ForumTagService {
  constructor(private prisma: PrismaService) {}

  async list(q?: string) {
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

  async create(user: User, body: { name?: string }) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw this.fail('name is required');
    const slug = slugifyCategoryName(name);
    try {
      const created = await this.prisma.forumTag.create({
        data: {
          name,
          slug,
          createdByAdminId: isAdminRole(user.role) ? user.id : null,
        },
        select: TAG_SELECT,
      });
      return {
        message: 'Successfully created forum tag',
        statusCode: 200,
        data: created,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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

  async update(user: User, id: string, body: { name?: string }) {
    this.assertAdmin(user);
    const name = String(body?.name ?? '').trim();
    if (!name) throw this.fail('name is required');
    try {
      const updated = await this.prisma.forumTag.update({
        where: { id },
        data: { name, slug: slugifyCategoryName(name) },
        select: TAG_SELECT,
      });
      return {
        message: 'Successfully updated forum tag',
        statusCode: 200,
        data: updated,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw this.fail('Tag not found');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.fail('A tag with this name already exists');
      }
      throw this.wrap(error);
    }
  }

  async remove(user: User, id: string) {
    this.assertAdmin(user);
    try {
      await this.prisma.forumTag.delete({ where: { id } });
      return {
        message: 'Successfully deleted forum tag',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw this.fail('Tag not found');
      }
      throw this.wrap(error);
    }
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
