import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { CreateScormPackageDto } from './dto';
import { ScormService } from './scorm.service';

@Controller('scorm')
export class ScormController {
  constructor(private readonly scorm: ScormService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('packages')
  @HttpCode(200)
  createPackage(
    @GetUser() admin: User,
    @Body() body: CreateScormPackageDto,
  ) {
    return this.scorm.createPackage(admin.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('packages/:id')
  getPackage(@Param('id') id: string) {
    return this.scorm.getPackage(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('packages/:id/import-status')
  getImportStatus(@GetUser() admin: User, @Param('id') id: string) {
    return this.scorm.getImportStatus(id, admin.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('courses/:courseId/packages')
  listPackages(@Param('courseId') courseId: string) {
    return this.scorm.listPackages(courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('courses/:courseId/replace-preview')
  replacePreview(@Param('courseId') courseId: string) {
    return this.scorm.replacePreview(courseId);
  }
}
