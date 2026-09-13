import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAdminStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const jwt_secret = config.get('JWT_SECRET');
    const jwt_expiry = config.get('JWT_EXPIRY');
    if (!jwt_secret || !jwt_expiry) {
      throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwt_secret,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user: User = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
    });
    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'UnAuthorized',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.role !== 'admin') {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    delete user.password;
    return user;
  }
}

@Injectable()
export class JwtUserStrategy extends PassportStrategy(Strategy, 'uJwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const jwt_secret = config.get('JWT_SECRET');
    const jwt_expiry = config.get('JWT_EXPIRY');
    if (!jwt_secret || !jwt_expiry) {
      throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwt_secret,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user: User = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
    });

    if (!user) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'User not found',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.role !== 'user') {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    delete user.password;
    return user;
  }
}

@Injectable()
export class JwtCombineStrategy extends PassportStrategy(Strategy, 'cJwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const jwt_secret = config.get('JWT_SECRET');
    const jwt_expiry = config.get('JWT_EXPIRY');
    if (!jwt_secret || !jwt_expiry) {
      throw new Error('JWT_SECRET or JWT_EXPIRY is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwt_secret,
    });
  }

  async validate(payload: { sub: string; email: string; exp: number }) {
    try {
      const now: any = Math.floor(Date.now() / 1000); // Current time in seconds

      // Check if token expiration is in the past
      if (payload.exp <= now) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: 'Token expiredss',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      const user: User = await this.prisma.user.findUnique({
        where: {
          id: payload.sub,
        },
      });

      if (!user) {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: 'User not found',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      if (user.role !== 'user' && user.role !== 'admin') {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: 'Forbidden',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      delete user.password;
      return user;
    } catch (error) {
      console.log({ error });
    }
  }
}

/**
 * High-frequency tracking pings only need `userId`. Passport already verified
 * the JWT signature (and expiry); the signed `sub` is enough. Skipping the
 * users-table round-trip is the single largest latency cut on `/heartbeat`.
 *
 * A deleted account can keep accruing until the token expires — acceptable for
 * telemetry. Other tracking routes keep `cJwt` and still load the user row.
 */
@Injectable()
export class JwtHeartbeatStrategy extends PassportStrategy(
  Strategy,
  'cJwtHeartbeat',
) {
  constructor(config: ConfigService) {
    const jwt_secret = config.get('JWT_SECRET');
    if (!jwt_secret) {
      throw new Error('JWT_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwt_secret,
    });
  }

  validate(payload: { sub?: string }) {
    if (!payload?.sub) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: 'UnAuthorized' },
        HttpStatus.FORBIDDEN,
      );
    }
    return { id: payload.sub };
  }
}
