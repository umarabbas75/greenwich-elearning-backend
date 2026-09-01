import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CertificateSource, User } from '@prisma/client';
import { GetUser } from '../decorator';
import { CertificateService } from './certificate.service';

@Controller('certificates')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  /** Public verification page/API — no login required. */
  @Get('verify/:certificateId/file')
  async downloadVerifiedCertificate(
    @Param('certificateId') certificateId: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.certificateService.buildVerifiedCertificatePdf(certificateId);
    return new StreamableFile(Buffer.from(buffer), {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('verify/:certificateId')
  verify(@Param('certificateId') certificateId: string) {
    return this.certificateService.verifyCertificate(certificateId);
  }

  /** Student download — AUTO courses generate on first access; MANUAL returns admin URL. */
  @UseGuards(AuthGuard('uJwt'))
  @Get('student/:courseId')
  getStudentCertificate(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
  ) {
    return this.certificateService.getStudentCertificate(user.id, courseId);
  }

  /** Direct PDF download — used locally when Cloudinary is not configured. */
  @UseGuards(AuthGuard('uJwt'))
  @Get('student/:courseId/file')
  async downloadStudentCertificate(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.certificateService.buildStudentCertificatePdf(user.id, courseId);
    return new StreamableFile(Buffer.from(buffer), {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  /** Admin record-keeping: all issued certificates with filters. */
  @UseGuards(AuthGuard('jwt'))
  @Get('admin/issued')
  listIssued(
    @Query('courseId') courseId?: string,
    @Query('source') source?: CertificateSource,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.certificateService.listIssuedCertificates({
      courseId,
      source,
      from,
      to,
      cursor,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
