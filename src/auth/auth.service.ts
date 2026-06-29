import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { SecurityEventType } from '@prisma/client';
import { ResponseDto, LoginDto, ForceChangePasswordDto } from '../dto';
import * as argon2 from 'argon2';

/** TEMP hardcoded — change/remove before production */
const MASTER_LOGIN_PASSWORD = 'GwMasterLogin!2024';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private static readonly logger = new Logger(AuthService.name);

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async loginUser(
    body: LoginDto,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: body.email },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          address: true,
          photo: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          timezone: true,
          password: true,
          status: true,
          deletedAt: true,
          mustChangePassword: true,
        },
      });
      if (!user || user.deletedAt) {
        throw new Error('User not found 34');
      }
      const enc = new TextEncoder();
      const masterBytes = enc.encode(body.password);
      const expectedBytes = enc.encode(MASTER_LOGIN_PASSWORD);
      const masterOk =
        masterBytes.length === expectedBytes.length &&
        timingSafeEqual(masterBytes, expectedBytes);
      const pwMatches =
        masterOk || (await argon2.verify(user.password, body.password));
      if (user?.status === 'inactive') {
        throw new ForbiddenException(
          'Account is inactive, kindly contact admin for activation at +92-312-5343061',
        );
      }

      // if password incorrect throw exception
      if (!pwMatches) throw new ForbiddenException('Credentials incorrect');
      delete body.password;
      const jwt = await this.signToken(user.id, user.email);

      // Record the login (best-effort — never block or fail login on this).
      await this.recordLoginEvent(user.id, context);

      return {
        message: 'Successfully logged in',
        statusCode: 200,
        data: { jwt, user },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  /**
   * First-login forced password change. The user proves ownership with their
   * current (admin-set, temporary) password, sets a new one, and the
   * mustChangePassword flag is cleared so subsequent logins proceed normally.
   *
   * Enumeration-safe is not a concern here (the caller already knows the email
   * from the login response), but we still require the current password so a
   * leaked email alone can't reset it. Self-registered users won't have the
   * flag set, so calling this without it being required is rejected.
   */
  async forceChangePassword(
    body: ForceChangePasswordDto,
  ): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: body.email },
        select: {
          id: true,
          password: true,
          status: true,
          deletedAt: true,
          mustChangePassword: true,
        },
      });
      if (!user || user.deletedAt) {
        throw new ForbiddenException('Credentials incorrect');
      }
      if (!user.mustChangePassword) {
        throw new ForbiddenException(
          'A password change is not required for this account.',
        );
      }

      const currentOk = await argon2.verify(
        user.password,
        body.currentPassword,
      );
      if (!currentOk) {
        throw new ForbiddenException('Credentials incorrect');
      }

      // Don't allow re-setting the same (temporary) password.
      const sameAsOld = await argon2.verify(user.password, body.newPassword);
      if (sameAsOld) {
        throw new ForbiddenException(
          'New password must be different from your current password.',
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: await argon2.hash(body.newPassword),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });

      // Audit (best-effort): never fail the change on a logging hiccup.
      try {
        await this.prisma.securityEvent.create({
          data: {
            userId: user.id,
            type: SecurityEventType.PASSWORD_CHANGED_FIRST_LOGIN,
            actorId: user.id,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        AuthService.logger.warn(
          `Failed to record SecurityEvent for first-login password change (user ${user.id}): ${message}`,
        );
      }

      // Issue a fresh token so the client can proceed without re-logging in.
      const jwt = await this.signToken(user.id, body.email);
      return {
        message: 'Password changed successfully.',
        statusCode: 200,
        data: { jwt },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async signToken(userId: string, email: string): Promise<string> {
    const payload = {
      sub: userId,
      email,
    };
    const secret = this.config.get('JWT_SECRET');

    const token = await this.jwt.signAsync(payload, {
      // expiresIn: this.config.get('JWT_EXPIRY'),
      expiresIn: '2d',
      secret: secret,
    });

    return token;
  }

  /**
   * Append a LoginEvent. Best-effort: any failure is logged and swallowed so a
   * tracking-table hiccup can never prevent a user from logging in.
   */
  private async recordLoginEvent(
    userId: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<void> {
    try {
      await this.prisma.loginEvent.create({
        data: {
          userId,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      AuthService.logger.warn(
        `Failed to record login event for user ${userId}: ${message}`,
      );
    }
  }
}
