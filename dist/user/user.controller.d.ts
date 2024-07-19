import { UserService } from './user.service';
import { BodyDto, ParamsDto, ResponseDto, ChangePasswordDto } from '../dto';
export declare class UserController {
    private readonly appService;
    constructor(appService: UserService);
    getAllUser(): Promise<ResponseDto>;
    getUser(params: ParamsDto): Promise<ResponseDto>;
    createUser(body: BodyDto): Promise<ResponseDto>;
    updateUser(params: ParamsDto, body: any): Promise<ResponseDto>;
    changePassword(params: ParamsDto, body: ChangePasswordDto): Promise<ResponseDto>;
    updatePassword(params: any, body: any): Promise<ResponseDto>;
    deleteUser(params: ParamsDto): Promise<ResponseDto>;
}
