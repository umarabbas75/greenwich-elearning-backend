import { createHash } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { CreateScormPackageDto, CreateScormPackageUploadDto } from './dto';
import { ScormService } from './scorm.service';

/** Matches app.setup body-parser limit; SCORM zips often exceed Cloudinary caps. */
const MAX_SCORM_ZIP_BYTES = 50 * 1024 * 1024;

const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
  'application/octet-stream',
]);

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
  @Post('packages/upload')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SCORM_ZIP_BYTES } }),
  )
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  createPackageUpload(
    @GetUser() admin: User,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CreateScormPackageUploadDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Multipart field "file" is required (SCORM .zip package)',
      );
    }
    const name = file.originalname?.toLowerCase() ?? '';
    const mimeOk = file.mimetype ? ZIP_MIME_TYPES.has(file.mimetype) : false;
    if (!mimeOk && !name.endsWith('.zip')) {
      throw new BadRequestException(
        'Upload must be a .zip SCORM package (application/zip)',
      );
    }
    const zipSha256 =
      body.zipSha256?.trim() ||
      createHash('sha256').update(file.buffer).digest('hex');
    return this.scorm.createPackageFromUpload(admin.id, file.buffer, {
      ...body,
      zipSha256,
      filename: file.originalname || 'package.zip',
    });
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
