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

  // Soft-deleted users (hidden from the main list) so admins can reach them to
  // restore or purge. Admin-only. Declared before '/:id' so it isn't matched
  // as an id.
  @UseGuards(AuthGuard('jwt'))
  @Get('/deleted')
  getDeletedUsers(): Promise<ResponseDto> {
    return this.appService.getDeletedUsers();
  }

  // Detail for a single soft-deleted user (getUser excludes them). Admin-only.
  // Declared before '/:id' so it isn't matched as an id.
  @UseGuards(AuthGuard('jwt'))
  @Get('/deleted/:id')
  getDeletedUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getDeletedUser(params.id);
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

  // Admin-only: soft delete a user.
  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id')
  deleteUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteUser(params.id);
  }

  // Reverse a soft delete: clears deletedAt and reactivates the account. Frees
  // the email so it can be used again, restoring all history under the same id.
  // Admin-only.
  @UseGuards(AuthGuard('jwt'))
  @Put('/:id/restore')
  restoreUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.restoreUser(params.id);
  }

  // Preview the blast radius of a permanent delete (no deletion happens).
  // Admin-only.
  @UseGuards(AuthGuard('jwt'))
  @Get('/:id/deletion-preview')
  getDeletionPreview(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getDeletionPreview(params.id);
  }

  // Admin / GDPR force-purge: permanently removes the user + self-owned records.
  // Admin-only.
  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id/purge')
  purgeUser(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.purgeUser(params.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/contact-us-message')
  createUserMessage(@Body() body: any, @GetUser() user: User): Promise<any> {
    return this.appService.createUserMessage(body, user);
  }
}
