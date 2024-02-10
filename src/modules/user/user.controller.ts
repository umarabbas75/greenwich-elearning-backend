import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { BodyDto, ParamsDto, ResponseDto, LoginDto } from '../../dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('/users')
export class UserController {
  constructor(private readonly appService: UserService) {}

  @Get('/')
  getAllUser(): Promise<ResponseDto> {
    return this.appService.getAllUsers();
  }

  @Get('/:id')
  getUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getUser(params.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/')
  createUser(@Body() body: BodyDto): Promise<ResponseDto> {
    return this.appService.createUser(body);
  }
  @Post('/login')
  loginUser(@Body() body: LoginDto): Promise<ResponseDto> {
    return this.appService.loginUser(body);
  }
}
