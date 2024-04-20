import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
  [x: string]: any;
  constructor(config: ConfigService) {
    super({
      datasources: {
        db: {
          url: config.get('DATABASE_URL'),
        },
      },
    });
  }

  // cleanDb() {
  //   return this.$transaction([
  //     this.courses.deleteMany(),
  //     this.user.deleteMany(),
  //   ]);
  // }
}