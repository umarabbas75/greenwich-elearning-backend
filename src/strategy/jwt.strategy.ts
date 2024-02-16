import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from '../database/database.providers';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
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

  async validate(payload: { sub: number; email: string }) {
    const user: any = await User.findOne({
      where: {
        id: payload.sub,
      },
    });
    if (user.role != 'admin') return null;
    delete user.password;
    return user;
  }
}
