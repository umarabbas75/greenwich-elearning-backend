import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import {
  ResponseDto,
  ForgotPasswordRequestDto,
  ForgotPasswordResendDto,
  VerifyOtpDto,
  ResetPasswordDto,
} from '../dto';
import { JwtAuthGuard } from './jwt.guard';
import { getClientIp, getUserAgent } from '../utils/client-request';

@Controller('/auth')
export class AuthController {
  constructor(
    private readonly appService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('/login')
  loginUser(@Body() body: any, @Req() req): Promise<ResponseDto> {
    return this.appService.loginUser(body, {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });
  }

  // ── Forgot-password flow ───────────────────────────────────────────────

  /** Step 1: request an OTP. Always 200 (no account enumeration). */
  @Post('/forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() body: ForgotPasswordRequestDto) {
    return this.passwordReset.requestReset(body);
  }

  /** Step 1b: resend the OTP (rate-limited). */
  @Post('/forgot-password/resend')
  @HttpCode(200)
  resendOtp(@Body() body: ForgotPasswordResendDto) {
    return this.passwordReset.resendReset(body);
  }

  /** Step 2: verify the OTP → returns a one-time reset token. */
  @Post('/forgot-password/verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.passwordReset.verifyOtp(body);
  }

  /** Step 3: set the new password using the reset token. */
  @Post('/forgot-password/reset')
  @HttpCode(200)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.passwordReset.resetPassword(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard) // Apply JWT authentication guard
  getMe(@Req() req) {
    // The authenticated user information is available in req.user
    const user = req.user;
    // You can customize the response format as needed
    return { user };
  }
}
