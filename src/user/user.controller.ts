import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { UserService } from './user.service';
import { BodyDto, ParamsDto, ResponseDto, ChangePasswordDto } from '../dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';

@Controller('/users')
export class UserController {
  constructor(private readonly appService: UserService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get('/contact-message')
  getAllUserMessages(@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getAllUserMessages(user.id, user.role);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  getAllUser(): Promise<ResponseDto> {
    return this.appService.getAllUsers();
  }
  // @UseGuards(AuthGuard('cJwt'))
  @Get('/:id')
  getUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getUser(params.id);
  }

  //@UseGuards(AuthGuard('cJwt'))
  @Post('/')
  createUser(@Body() body: BodyDto): Promise<ResponseDto> {
    return this.appService.createUser(body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/:id')
  updateUser(
    @Param() params: ParamsDto,
    @Body() body: any,
  ): Promise<ResponseDto> {
    return this.appService.updateUser(params.id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/changePassword/:id')
  changePassword(
    @Param() params: ParamsDto,
    @Body() body: ChangePasswordDto,
  ): Promise<ResponseDto> {
    return this.appService.changePassword(params.id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/updatePassword/:userId')
  updatePassword(
    @Param() params: any,
    @Body() body: any,
  ): Promise<ResponseDto> {
    return this.appService.updatePassword(params.userId, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:id')
  deleteUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteUser(params.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/contact-us-message')
  createUserMessage(@Body() body: any, @GetUser() user: User): Promise<any> {
    return this.appService.createUserMessage(body, user);
  }
}
