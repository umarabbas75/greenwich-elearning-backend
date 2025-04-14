import { AuthService } from './auth.service';
import { ResponseDto } from '../dto';
export declare class AuthController {
    private readonly appService;
    constructor(appService: AuthService);
    loginUser(body: any): Promise<ResponseDto>;
    getMe(req: any): {
        user: any;
    };
}
