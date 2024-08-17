import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ResponseDto, LoginDto } from '../dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async loginUser(body: LoginDto): Promise<ResponseDto> {
    try {
      const user: any = await this.prisma.user.findUnique({
        where: { email: body.email },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          photo: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          timezone: true,
          password: true,
        },
      });
      if (!user) {
        throw new Error('User not found 34');
      }
      const pwMatches = await argon2.verify(user.password, body.password);
      // if password incorrect throw exception
      if (!pwMatches) throw new ForbiddenException('Credentials incorrect');
      delete body.password;
      const jwt = await this.signToken(user.id, user.email);
      return {
        message: 'Successfully logged in',
        statusCode: 200,
        data: { jwt, user },
      };
    } catch (error) {
      console.log([error]);
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
}
