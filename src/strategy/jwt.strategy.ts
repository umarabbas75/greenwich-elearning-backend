import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';
import { User } from '../database/database.providers';
import * as dotenv from 'dotenv';
dotenv.config();
@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
  'jwt',
) {
  constructor(
  ) {
    if(!process.env?.JWT_SECRET){
      throw new Error("JWT_SECRET is not set");
  }
    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: {
    sub: number;
    email: string;
  }) {
    const user :any =
      await User.findOne({
        where: {
          id: payload.sub,
        },
      });
      if(user.role != "admin") return null
    delete user.password;
    return user
  }
}