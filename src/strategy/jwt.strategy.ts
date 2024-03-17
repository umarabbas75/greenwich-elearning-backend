import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';

abstract class BaseJwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    strategyName: string,
    config: ConfigService,
    protected readonly prisma: PrismaService,
    protected readonly expectedRole: string
  ) {
    const jwt_secret = config.get('JWT_SECRET');
    if (!jwt_secret) {
      throw new Error('JWT_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwt_secret,
      passReqToCallback: true,
    }, strategyName);
  }

  async validate(payload: { sub: string; email: string }): Promise<User> {
    const user: User = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
    });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.FORBIDDEN);
    }
    if (user.role !== this.expectedRole) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    delete user.password;
    return user;
  }
}


@Injectable()
export class JwtAdminStrategy extends BaseJwtStrategy {
  constructor(config: ConfigService, prisma: PrismaService) {
    super('jwt', config, prisma, 'admin');
  }
}

@Injectable()
export class JwtUserStrategy extends BaseJwtStrategy {
  constructor(config: ConfigService, prisma: PrismaService) {
    super('uJwt', config, prisma, 'user');
  }
}
