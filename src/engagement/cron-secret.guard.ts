import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards internal cron endpoints. Accepts the shared secret from either:
 *   - `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's native header), or
 *   - `x-cron-secret: <CRON_SECRET>`.
 *
 * Machine-to-machine only — deliberately separate from the user/admin JWT
 * guards. If CRON_SECRET is unset the endpoint is denied (fail closed) so a
 * misconfigured deploy can't expose an unauthenticated sweep trigger.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly logger = new Logger(CronSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected) {
      this.logger.error(
        'CRON_SECRET is not configured — denying cron request.',
      );
      throw new UnauthorizedException('Cron secret not configured');
    }

    const req = context.switchToHttp().getRequest();
    const provided = this.extractSecret(req);
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return true;
  }

  private extractSecret(req: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string') {
      const [scheme, token] = auth.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) return token;
    }
    const custom = req.headers['x-cron-secret'];
    if (typeof custom === 'string' && custom) return custom;
    return null;
  }
}
