import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ResponseDto } from '../dto';
import { JwtAuthGuard } from './jwt.guard';

@Controller('/auth')
export class AuthController {
  constructor(private readonly appService: AuthService) {}

  @Post('/login')
  loginUser(@Body() body: any): Promise<ResponseDto> {
    return this.appService.loginUser(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard) // Apply JWT authentication guard
  getMe(@Req() req) {
    // The authenticated user information is available in req.user
    const user = req.user;
    // You can customize the response format as needed
    return { user };
  }
}
