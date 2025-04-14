import { ResponseDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class TodoService {
    private prisma;
    constructor(prisma: PrismaService);
    getTodos(userId: string): Promise<ResponseDto>;
    getTodo(userId: string, todoId: any): Promise<ResponseDto>;
    createTodo(userId: any, body: any): Promise<ResponseDto>;
    updateTodo(id: string, body: any): Promise<ResponseDto>;
    deleteTodo(id: string): Promise<ResponseDto>;
}
