import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService,  private prisma: PrismaService) {
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
      }
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
