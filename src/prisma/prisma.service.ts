import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { withDbRetry } from '../utils/with-db-retry';

const globalForPrisma = globalThis as unknown as { nestPrisma?: PrismaService };

const READ_ACTIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

@Injectable()
export class PrismaService extends PrismaClient {
  private static readonly retryLogger = new Logger('PrismaRetry');

  constructor(config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    const isTest = process.env.NODE_ENV === 'test';

    if (globalForPrisma.nestPrisma && !isTest) {
      return globalForPrisma.nestPrisma as unknown as PrismaService;
    }

    super({
      datasources: {
        db: {
          url,
        },
      },
    });

    if (!isTest) {
      globalForPrisma.nestPrisma = this;
    }

    // TODO(prisma-6): $use is deprecated in Prisma 5+; migrate to $extends({ query: { $allOperations } }).
    // Note: $use does not run for $queryRaw / $executeRaw — wrap those explicitly if retries are needed.
    this.$use(async (params, next) => {
      const mode = READ_ACTIONS.has(params.action) ? 'read' : 'write';
      return withDbRetry(() => next(params), {
        mode,
        onRetry: ({ attempt, maxAttempts, code }) => {
          PrismaService.retryLogger.warn(
            `DB transient error, retrying (${attempt}/${maxAttempts}) model=${String(params.model)} action=${params.action} code=${code ?? 'n/a'}`,
          );
        },
      });
    });
  }
}
