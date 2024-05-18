"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TodoService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let TodoService = class TodoService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTodos(userId) {
        try {
            const [todos, totalCount] = await Promise.all([
                this.prisma.todoItem.findMany({
                    orderBy: {
                        createdAt: 'desc',
                    },
                    where: { userId: userId },
                }),
                this.prisma.todoItem.count({
                    where: { userId: userId },
                }),
            ]);
            return {
                message: 'Successfully fetch all todos info',
                statusCode: 200,
                data: { todos, totalCount },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async getTodo(userId, todoId) {
        try {
            const todos = await this.prisma.todoItem.findUnique({
                where: { userId: userId, id: todoId },
            });
            return {
                message: 'Successfully fetch all todos info',
                statusCode: 200,
                data: todos,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async createTodo(userId, body) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const newTodo = await this.prisma.todoItem.create({
                data: {
                    title: body.title,
                    content: body.content,
                    dueDate: body.dueDate,
                    userId,
                },
            });
            return {
                message: 'Successfully created new todo item',
                statusCode: 200,
                data: newTodo,
            };
        }
        catch (error) {
            console.log('create error', error);
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                error: error?.message || 'Failed to create todo',
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async updateTodo(id, body) {
        try {
            const isTodoExist = await this.prisma.todoItem.findUnique({
                where: { id: id },
            });
            if (!isTodoExist) {
                throw new Error('Todo item does not exist ');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateTodo = {};
            for (const [key, value] of Object.entries(body)) {
                updateTodo[key] = value;
            }
            await this.prisma.todoItem.update({
                where: { id },
                data: updateTodo,
            });
            return {
                message: 'Successfully updated todo record',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            console.log({ error });
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async deleteTodo(id) {
        try {
            const todo = await this.prisma.todoItem.findUnique({
                where: { id },
            });
            if (!todo) {
                throw new Error('Todo item not found');
            }
            await this.prisma.todoItem.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted todo record',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2003') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Cannot delete course because it is associated with other records.',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            else {
                console.log({ error });
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
};
exports.TodoService = TodoService;
exports.TodoService = TodoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TodoService);
//# sourceMappingURL=todo.service.js.map