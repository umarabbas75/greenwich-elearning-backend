import { UserService } from './user.service';
import { BodyDto, BodyUpdateDto, ParamsDto, ResponseDto, ChangePasswordDto, AdminChangeUserEmailDto } from '../dto';
import { User } from '@prisma/client';
export declare class UserController {
    private readonly appService;
    constructor(appService: UserService);
    getAllUserMessages(user: User): Promise<ResponseDto>;
    getAllUser(): Promise<ResponseDto>;
    getDeletedUsers(): Promise<ResponseDto>;
    getDeletedUser(params: ParamsDto): Promise<ResponseDto>;
    getUser(params: ParamsDto): Promise<ResponseDto>;
    createUser(body: BodyDto): Promise<ResponseDto>;
    changeUserEmail(params: ParamsDto, body: AdminChangeUserEmailDto, admin: User): Promise<ResponseDto>;
    updateUser(params: ParamsDto, body: BodyUpdateDto, requester: User): Promise<ResponseDto>;
    changePassword(params: ParamsDto, body: ChangePasswordDto): Promise<ResponseDto>;
    updatePassword(params: any, body: any): Promise<ResponseDto>;
    deleteUser(params: ParamsDto): Promise<ResponseDto>;
    restoreUser(params: ParamsDto): Promise<ResponseDto>;
    getDeletionPreview(params: ParamsDto): Promise<ResponseDto>;
    purgeUser(params: ParamsDto): Promise<ResponseDto>;
    createUserMessage(body: any, user: User): Promise<any>;
}
