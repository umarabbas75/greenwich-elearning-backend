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
exports.UserService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const argon2 = require("argon2");
const prisma_service_1 = require("../prisma/prisma.service");
let UserService = class UserService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getUser(id) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    photo: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                    timezone: true,
                },
            });
            if (!user) {
                throw new Error('User not found');
            }
            return {
                message: 'Successfully fetch user info',
                statusCode: 200,
                data: user,
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
    async getAllUsers() {
        try {
            const users = await this.prisma.user.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    photo: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                    password: true,
                    courses: true,
                },
            });
            if (!(users.length > 0)) {
                throw new Error('No Users found');
            }
            return {
                message: 'Successfully fetch all users info',
                statusCode: 200,
                data: users,
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
    async createUser(body) {
        try {
            const isUserExist = await this.prisma.user.findUnique({
                where: { email: body?.email },
            });
            if (isUserExist) {
                throw new Error('credentials already taken');
            }
            const password = await argon2.hash(body.password);
            delete body.password;
            const user = await this.prisma.user.create({
                data: {
                    firstName: body?.firstName,
                    lastName: body?.lastName,
                    email: body?.email,
                    password,
                    phone: body.phone,
                    role: body.role,
                    photo: body?.photo ?? null,
                },
            });
            delete user.password;
            return {
                message: 'Successfully create user record',
                statusCode: 200,
                data: user,
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
    async updateUser(userId, body) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new Error('User not found');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateUser = {};
            for (const [key, value] of Object.entries(body)) {
                updateUser[key] = value;
            }
            const updatedUser = await this.prisma.user.update({
                where: { id: userId },
                data: updateUser,
            });
            return {
                message: 'Successfully updated user record',
                statusCode: 200,
                data: updatedUser,
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
    async changePassword(userId, body) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new Error('User not found');
            }
            const isOldPasswordValid = await argon2.verify(existingUser.password, body.oldPassword);
            if (!isOldPasswordValid) {
                throw new Error('Old password is incorrect');
            }
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    password: await argon2.hash(body.password),
                },
            });
            return {
                message: 'Successfully updated user password',
                statusCode: 200,
                data: {},
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
    async deleteUser(id) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id },
            });
            if (!user?.id) {
                throw new Error('User not found');
            }
            await this.prisma.user.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted user record',
                statusCode: 200,
                data: user,
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2003') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Cannot delete it because it is associated with other records.',
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
exports.UserService = UserService;
exports.UserService = UserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UserService);
//# sourceMappingURL=user.service.js.map