import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ForgotPasswordRequestDto, ForgotPasswordResendDto, ResetPasswordDto, VerifyOtpDto } from '../dto';
export declare class PasswordResetService {
    private readonly prisma;
    private readonly mail;
    private readonly logger;
    private static readonly OTP_TTL_MINUTES;
    private static readonly RESET_TOKEN_TTL_MINUTES;
    private static readonly MAX_VERIFY_ATTEMPTS;
    private static readonly MAX_RESENDS;
    private static readonly RESEND_COOLDOWN_SECONDS;
    private static readonly GENERIC_REQUEST_MESSAGE;
    constructor(prisma: PrismaService, mail: MailService);
    requestReset(body: ForgotPasswordRequestDto): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    resendReset(body: ForgotPasswordResendDto): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    verifyOtp(body: VerifyOtpDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            resetToken: string;
            expiresInMinutes: number;
        };
    }>;
    resetPassword(body: ResetPasswordDto): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    private findActiveUser;
    private latestActiveReset;
    private issueAndSendOtp;
    private assertResendAllowed;
    private generateOtp;
    private genericResponse;
    private badRequest;
}
