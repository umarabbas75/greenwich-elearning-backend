import { UserService } from './user.service';
import { BodyDto, ParamsDto, ResponseDto, ChangePasswordDto } from '../dto';
import { User } from '@prisma/client';
export declare class UserController {
    private readonly appService;
    constructor(appService: UserService);
    getAllUserMessages(user: User): Promise<ResponseDto>;
    getAllUser(): Promise<ResponseDto>;
    getUser(params: ParamsDto): Promise<ResponseDto>;
    createUser(body: BodyDto): Promise<ResponseDto>;
    updateUser(params: ParamsDto, body: any): Promise<ResponseDto>;
    changePassword(params: ParamsDto, body: ChangePasswordDto): Promise<ResponseDto>;
    updatePassword(params: any, body: any): Promise<ResponseDto>;
    deleteUser(params: ParamsDto): Promise<ResponseDto>;
    createUserMessage(body: any, user: User): Promise<any>;
}
