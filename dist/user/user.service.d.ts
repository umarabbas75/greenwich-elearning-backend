import { ResponseDto, BodyDto, BodyUpdateDto, ChangePasswordDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class UserService {
    private prisma;
    constructor(prisma: PrismaService);
    getUser(id: string): Promise<ResponseDto>;
    getAllUsers(): Promise<ResponseDto>;
    createUser(body: BodyDto): Promise<ResponseDto>;
    updateUser(userId: string, body: BodyUpdateDto): Promise<ResponseDto>;
    changePassword(userId: string, body: ChangePasswordDto): Promise<ResponseDto>;
    updatePassword(userId: string, body: any): Promise<ResponseDto>;
    deleteUser(id: string): Promise<ResponseDto>;
}
