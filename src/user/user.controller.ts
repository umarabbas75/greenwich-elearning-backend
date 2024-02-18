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
import {
  BodyDto,
  ParamsDto,
  ResponseDto,
  BodyUpdateDto,
  ChangePasswordDto,
} from '../dto';
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

  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateUser(
    @Param() params: ParamsDto,
    @Body() body: BodyUpdateDto,
  ): Promise<ResponseDto> {
    return this.appService.updateUser(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/changePassword/:id')
  changePassword(
    @Param() params: ParamsDto,
    @Body() body: ChangePasswordDto,
  ): Promise<ResponseDto> {
    return this.appService.changePassword(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id')
  deleteUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteUser(params.id);
  }
}
