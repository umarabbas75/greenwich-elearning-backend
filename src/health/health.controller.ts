import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Uses $queryRaw on purpose: Prisma $use middleware does not wrap raw SQL, so this reflects
   * real DB reachability without retry masking (good for a probe).
   */
  @Get('db')
  async db(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
  }
}
