import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { ResponseDto, ForgotPasswordRequestDto, ForgotPasswordResendDto, VerifyOtpDto, ResetPasswordDto } from '../dto';
export declare class AuthController {
    private readonly appService;
    private readonly passwordReset;
    constructor(appService: AuthService, passwordReset: PasswordResetService);
    loginUser(body: any, req: any): Promise<ResponseDto>;
    forgotPassword(body: ForgotPasswordRequestDto): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    resendOtp(body: ForgotPasswordResendDto): Promise<{
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
    getMe(req: any): {
        user: any;
    };
}
