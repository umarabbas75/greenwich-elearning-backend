import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { User } from '../../database/database.providers';
import { ResponseDto, BodyDto ,LoginDto} from '../../dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class UserService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async getUser(id: string): Promise<ResponseDto> {
    try {
      let user:any = await User.findOne({ where: { id } ,  attributes: { exclude: ['password'] }});
      if (!user){
        throw new Error('User not found')
      }
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async getAllUsers(): Promise<ResponseDto> {
    try {
      let users = await User.findAll({ 
        attributes: { exclude: ['password'] },
        // offset: 10,
        limit: 10,
    });
      if (!(users.length > 0)){
        throw new Error('No Users found')
      }
      return {
        message: 'Successfully fetch all users info',
        statusCode: 200,
        data: users,
      };
    } catch (error) {

      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }

  async createUser(body: BodyDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['firstName', 'lastName', 'email', 'password', 'phone','role'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }

      let isUserExist:any = await User.findOne({ where: { email:body.email }})  
      if(isUserExist){
        throw new Error("credentials already taken");
      }
      let password = await argon2.hash(body.password);
      delete body.password;

      let user:any = await User.create({
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        password,
        phone: body.phone,
        role: body.role,
        photo: body?.photo ?? 'https://avatar.iran.liara.run/public/boy?username=Ash',
        timestamp: Date.now(),
      });
      delete user.password;
      return {
        message: 'Successfully create user record',
        statusCode: 200,
        data:user
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }


  async loginUser(body: LoginDto): Promise<ResponseDto> {
    try {
      let required = [ 'email', 'password'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }

      let user:any = await User.findOne({ where: { email:body.email } });
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };

      await argon2.verify(user.password, body.password)
      delete body.password;
      let jwt = await  this.signToken(user.id, user.email);
      return {
        message: 'Successfully loged in',
        statusCode: 200,
        data: {jwt},
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async signToken(
    userId: number,
    email: string,
  ): Promise<string> {
    const payload = {
      sub: userId,
      email,
    };
    const secret = this.config.get('JWT_SECRET')

    const token = await this.jwt.signAsync(
      payload,
      {
        expiresIn: '15m',
        secret: secret,
      },
    );

    return token;
  }

}
