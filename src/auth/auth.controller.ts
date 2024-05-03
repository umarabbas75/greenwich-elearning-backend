import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ResponseDto, LoginDto } from '../dto';

@Controller('/auth')
export class AuthController {
  constructor(private readonly appService: AuthService) {}

  @Post('/login')
  loginUser(@Body() body: any): Promise<ResponseDto> {
    console.log({body})
    return this.appService.loginUser(body);
  }
}
