import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';
import { User } from '../database/database.providers';

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
  'jwt',
) {
  constructor(
  ) {
    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: "my_secret",
    });
  }

  async validate(payload: {
    sub: number;
    email: string;
  }) {
    // console.log("---->",payload)
    const user :any =
      await User.findOne({
        where: {
          id: payload.sub,
        },
      });
      if(user.role != "admin") return null
      // console.log(user)
    delete user.password;
    return user
  }
}