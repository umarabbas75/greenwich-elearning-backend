import { Injectable } from '@nestjs/common';
import { User } from '../../database/database.providers';
import { ResponseDto, BodyDto ,LoginDto} from '../../dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';


@Injectable()
export class UserService {
  constructor(
    private jwt: JwtService
  ) {}

  async getUser(email: string): Promise<ResponseDto> {
    try {
      let user:any = await User.findOne({ where: { email } ,  attributes: { exclude: ['password'] }});
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };
       
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }
  async getAllUsers(): Promise<ResponseDto> {
    try {
      let users = await User.findAll({ 
        attributes: { exclude: ['password'] },
        // offset: 10,
        limit: 10,
    });
      if (!users)
        return { message: 'No Users found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch all users info',
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }

  async createUser(body: BodyDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['firstName', 'lastName', 'email', 'password', 'phone','role'];
      for (let key of required) {
        if (!body?.[key])
          return { message: `${key} is required`, statusCode: 400, data: {} };
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
      console.log(error);
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }


  async loginUser(body: LoginDto): Promise<ResponseDto> {
    try {
      let required = [ 'email', 'password'];
      for (let key of required) {
        if (!body?.[key])
          return { message: `${key} is required`, statusCode: 400, data: {} };
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
      console.log(error);
      return { message: 'Something went wrong', statusCode: 500, data: {} };
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
    const secret = "my_secret"

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
