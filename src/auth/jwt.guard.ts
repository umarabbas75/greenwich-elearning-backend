import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractJwtFromRequest(request);

    if (!token) {
      return false; // No token found, request is not authenticated
    }

    try {
      const decoded = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET'),
      });
      request.user = decoded; // Attach decoded user information to the request
      return true; // Request is authenticated
    } catch (error) {
      return false; // JWT verification failed, request is not authenticated
    }
  }

  private extractJwtFromRequest(request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null; // No authorization header found
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return null; // Invalid authorization header format
    }
    return parts[1]; // Return the JWT token
  }
}
