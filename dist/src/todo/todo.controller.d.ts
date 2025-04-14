import { TodoService } from './todo.service';
import { ResponseDto } from '../dto';
import { User } from '@prisma/client';
export declare class TodoController {
    private readonly appService;
    constructor(appService: TodoService);
    getTodos(user: User): Promise<ResponseDto>;
    getTodo(user: User, params: any): Promise<ResponseDto>;
    createTodo(body: any, user: User): Promise<ResponseDto>;
    updateTodo(body: any): Promise<ResponseDto>;
    deleteTodo(params: any): Promise<ResponseDto>;
}
