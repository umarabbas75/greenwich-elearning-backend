import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * HTTP Basic against SCORM_POSTBACK_AUTH_USER / PASSWORD.
 * Fail closed if either is unset. Length-check before timingSafeEqual so
 * unequal-length secrets do not throw (same pattern as auth.service.ts).
 */
@Injectable()
export class ScormPostbackGuard implements CanActivate {
  private readonly logger = new Logger(ScormPostbackGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedUser = this.config.get<string>('SCORM_POSTBACK_AUTH_USER');
    const expectedPass = this.config.get<string>(
      'SCORM_POSTBACK_AUTH_PASSWORD',
    );
    if (!expectedUser || !expectedPass) {
      this.logger.error(
        'SCORM_POSTBACK_AUTH_USER/PASSWORD are not configured — denying postback.',
      );
      throw new UnauthorizedException('Postback auth is not configured');
    }

    const req = context.switchToHttp().getRequest();
    const parsed = parseBasicAuth(req.headers?.authorization);
    if (!parsed) {
      throw new UnauthorizedException('Invalid postback credentials');
    }

    if (
      !safeEqual(parsed.user, expectedUser) ||
      !safeEqual(parsed.password, expectedPass)
    ) {
      throw new UnauthorizedException('Invalid postback credentials');
    }
    return true;
  }
}

export function parseBasicAuth(
  header: unknown,
): { user: string; password: string } | null {
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return {
      user: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

export function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
