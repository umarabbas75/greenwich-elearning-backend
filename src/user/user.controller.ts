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
import { JwtAdminStrategy } from 'src/strategy';

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

  @UseGuards(JwtAdminStrategy)
  @Post('/')
  createUser(@Body() body: BodyDto): Promise<ResponseDto> {
    return this.appService.createUser(body);
  }

  @UseGuards(JwtAdminStrategy)
  @Put('/:id')
  updateUser(
    @Param() params: ParamsDto,
    @Body() body: BodyUpdateDto,
  ): Promise<ResponseDto> {
    return this.appService.updateUser(params.id, body);
  }

  @UseGuards(JwtAdminStrategy)
  @Put('/changePassword/:id')
  changePassword(
    @Param() params: ParamsDto,
    @Body() body: ChangePasswordDto,
  ): Promise<ResponseDto> {
    return this.appService.changePassword(params.id, body);
  }

  @UseGuards(JwtAdminStrategy)
  @Delete('/:id')
  deleteUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteUser(params.id);
  }
}
