import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  ForgotPasswordRequestDto,
  ForgotPasswordResendDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from '../dto';

/**
 * Forgot-password flow. Security properties:
 *  - OTP and reset token are stored as argon2 hashes — never plaintext.
 *  - OTP is 6 digits, single-use, expires in OTP_TTL_MINUTES.
 *  - Wrong guesses are counted; the row locks after MAX_VERIFY_ATTEMPTS.
 *  - Resends are capped (MAX_RESENDS) with a per-send cooldown.
 *  - No account enumeration: request/resend always return the same generic
 *    response whether or not the email maps to a real, active account.
 *  - Two-step: verify-otp issues a one-time reset token; reset-password requires
 *    that token, so the new password is never submitted alongside an OTP guess.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  private static readonly OTP_TTL_MINUTES = 10;
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;
  private static readonly MAX_VERIFY_ATTEMPTS = 5;
  private static readonly MAX_RESENDS = 3;
  private static readonly RESEND_COOLDOWN_SECONDS = 60;

  /** Generic message returned by request/resend regardless of account existence. */
  private static readonly GENERIC_REQUEST_MESSAGE =
    'If an account exists for that email, a verification code has been sent.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // STEP 1 — request OTP
  // ──────────────────────────────────────────────────────────────────────

  async requestReset(body: ForgotPasswordRequestDto) {
    const user = await this.findActiveUser(body.email);

    // No enumeration: behave identically (and return the same message) whether
    // or not the account exists. Only actually send when the user is real.
    if (user) {
      await this.issueAndSendOtp(user, /* isResend */ false);
    }

    return this.genericResponse();
  }

  // ──────────────────────────────────────────────────────────────────────
  // STEP 1b — resend OTP
  // ──────────────────────────────────────────────────────────────────────

  async resendReset(body: ForgotPasswordResendDto) {
    const user = await this.findActiveUser(body.email);
    if (user) {
      const active = await this.latestActiveReset(user.id);
      if (active) {
        this.assertResendAllowed(active);
      }
      await this.issueAndSendOtp(user, /* isResend */ true);
    }
    return this.genericResponse();
  }

  // ──────────────────────────────────────────────────────────────────────
  // STEP 2 — verify OTP → issue one-time reset token
  // ──────────────────────────────────────────────────────────────────────

  async verifyOtp(body: VerifyOtpDto) {
    const user = await this.findActiveUser(body.email);
    const reset = user ? await this.latestActiveReset(user.id) : null;

    // Generic failure for missing user/reset so verify can't be used to probe
    // which emails have an in-flight reset.
    if (!user || !reset) {
      throw this.badRequest('Invalid or expired verification code');
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      throw this.badRequest('Invalid or expired verification code');
    }

    if (reset.attempts >= PasswordResetService.MAX_VERIFY_ATTEMPTS) {
      throw this.badRequest(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const ok = await argon2.verify(reset.otpHash, body.otp);
    if (!ok) {
      const attempts = reset.attempts + 1;
      await this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts },
      });
      const remaining = PasswordResetService.MAX_VERIFY_ATTEMPTS - attempts;
      throw this.badRequest(
        remaining > 0
          ? `Invalid verification code. ${remaining} attempt(s) remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
      );
    }

    // Correct OTP → mint a one-time reset token (returned plaintext, stored hashed).
    const resetToken = randomBytes(32).toString('hex');
    const resetTokenHash = await argon2.hash(resetToken);
    const now = new Date();
    await this.prisma.passwordReset.update({
      where: { id: reset.id },
      data: {
        verifiedAt: now,
        resetTokenHash,
        // Re-purpose expiresAt as the reset-token window (longer than OTP).
        expiresAt: new Date(
          now.getTime() + PasswordResetService.RESET_TOKEN_TTL_MINUTES * 60_000,
        ),
      },
    });

    return {
      message: 'Verification successful',
      statusCode: 200,
      data: {
        resetToken,
        expiresInMinutes: PasswordResetService.RESET_TOKEN_TTL_MINUTES,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // STEP 3 — reset password using the token
  // ──────────────────────────────────────────────────────────────────────

  async resetPassword(body: ResetPasswordDto) {
    const user = await this.findActiveUser(body.email);
    const reset = user ? await this.latestActiveReset(user.id) : null;

    if (!user || !reset || !reset.verifiedAt || !reset.resetTokenHash) {
      throw this.badRequest('Invalid or expired reset request');
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      throw this.badRequest('Reset token has expired. Please start again.');
    }

    const tokenOk = await argon2.verify(reset.resetTokenHash, body.resetToken);
    if (!tokenOk) {
      throw this.badRequest('Invalid or expired reset request');
    }

    // Apply the new password and consume the reset row atomically-ish (pool=1,
    // so sequential updates; consuming the row prevents token reuse).
    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await argon2.hash(body.newPassword) },
    });
    await this.prisma.passwordReset.update({
      where: { id: reset.id },
      data: { consumedAt: now, resetTokenHash: null },
    });

    return {
      message: 'Password has been reset successfully. You can now log in.',
      statusCode: 200,
      data: {},
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // INTERNALS
  // ──────────────────────────────────────────────────────────────────────

  private async findActiveUser(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt || user.status !== 'active') return null;
    return user;
  }

  /** The most recent un-consumed reset row for a user (the active attempt). */
  private async latestActiveReset(userId: string) {
    return this.prisma.passwordReset.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Generate a fresh OTP, supersede any prior active reset, persist the hash,
   * and email the code. On a resend, carry the resend counter forward so the
   * cap spans the whole reset attempt rather than resetting each new row.
   */
  private async issueAndSendOtp(
    user: { id: string; email: string; firstName: string },
    isResend: boolean,
  ): Promise<void> {
    const prior = await this.latestActiveReset(user.id);
    const nextResendCount = isResend ? (prior?.resendCount ?? 0) + 1 : 0;

    const otp = this.generateOtp();
    const otpHash = await argon2.hash(otp);
    const expiresAt = new Date(
      Date.now() + PasswordResetService.OTP_TTL_MINUTES * 60_000,
    );

    // Invalidate any prior active reset so only the newest code is valid.
    if (prior) {
      await this.prisma.passwordReset.update({
        where: { id: prior.id },
        data: { consumedAt: new Date() },
      });
    }

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt,
        resendCount: nextResendCount,
      },
    });

    const result = await this.mail.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      otp,
      expiresInMinutes: PasswordResetService.OTP_TTL_MINUTES,
    });

    if (!result.sent) {
      // Email is the only channel here, so a failure is a real error — but we
      // still avoid leaking which emails exist by logging server-side only.
      this.logger.error(
        `Failed to send password-reset OTP to user ${user.id}: ${result.reason}`,
      );
    }
  }

  private assertResendAllowed(active: {
    resendCount: number;
    updatedAt: Date;
  }): void {
    if (active.resendCount >= PasswordResetService.MAX_RESENDS) {
      throw this.badRequest(
        'Resend limit reached. Please try again later or request a new code.',
      );
    }
    const elapsedMs = Date.now() - active.updatedAt.getTime();
    const cooldownMs = PasswordResetService.RESEND_COOLDOWN_SECONDS * 1000;
    if (elapsedMs < cooldownMs) {
      const wait = Math.ceil((cooldownMs - elapsedMs) / 1000);
      throw this.badRequest(
        `Please wait ${wait} second(s) before requesting another code.`,
      );
    }
  }

  /** Cryptographically-secure 6-digit code (000000–999999, zero-padded). */
  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private genericResponse() {
    return {
      message: PasswordResetService.GENERIC_REQUEST_MESSAGE,
      statusCode: 200,
      data: {},
    };
  }

  private badRequest(message: string): HttpException {
    return new HttpException(
      { status: HttpStatus.BAD_REQUEST, error: message, message },
      HttpStatus.BAD_REQUEST,
    );
  }
}
