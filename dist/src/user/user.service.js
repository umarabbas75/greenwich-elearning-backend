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
var UserService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const argon2 = require("argon2");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
let UserService = UserService_1 = class UserService {
    constructor(prisma, mail) {
        this.prisma = prisma;
        this.mail = mail;
    }
    async recordPasswordChange(userId) {
        try {
            await this.prisma.securityEvent.create({
                data: {
                    userId,
                    type: client_1.SecurityEventType.PASSWORD_CHANGED,
                    actorId: userId,
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            UserService_1.logger.warn(`Failed to record SecurityEvent for password change (user ${userId}): ${message}`);
        }
    }
    async getUser(id) {
        try {
            const user = await this.prisma.user.findFirst({
                where: { id, deletedAt: null },
                include: {
                    UserCourse: {
                        include: {
                            course: {
                                include: {
                                    courseForms: {
                                        include: {
                                            userFormCompletions: {
                                                where: { userId: id },
                                                select: {
                                                    isComplete: true,
                                                    completedAt: true,
                                                    metadata: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const coursesWithForms = user.UserCourse.map((userCourse) => {
                const course = userCourse.course;
                const totalForms = course.courseForms.length;
                const completedForms = course.courseForms.filter((form) => form.userFormCompletions.length > 0 &&
                    form.userFormCompletions[0].isComplete).length;
                return {
                    courseId: course.id,
                    courseTitle: course.title,
                    courseImage: course.image,
                    totalForms,
                    completedForms,
                    forms: course.courseForms.map((form) => ({
                        formId: form.formId,
                        formName: form.formName,
                        isRequired: form.isRequired,
                        isComplete: form.userFormCompletions[0]?.isComplete || false,
                        completedAt: form.userFormCompletions[0]?.completedAt || null,
                        metadata: form.userFormCompletions[0]?.metadata || null,
                    })),
                };
            });
            const response = {
                userInfo: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    address: user.address,
                    photo: user.photo,
                    role: user.role,
                },
                courses: coursesWithForms,
            };
            return {
                message: 'Successfully fetched user info with course forms',
                statusCode: 200,
                data: response,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                error: error?.message || 'Failed to fetch user information',
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR, {
                cause: error,
            });
        }
    }
    async getAllUsers() {
        try {
            const users = await this.prisma.user.findMany({
                where: { deletedAt: null },
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    UserCourse: {
                        include: {
                            course: {
                                select: {
                                    id: true,
                                    title: true,
                                    description: true,
                                },
                            },
                        },
                    },
                },
            });
            if (users.length === 0) {
                throw new Error('No users found');
            }
            const transformedUsers = users.map((user) => ({
                ...user,
                courses: user.UserCourse.map((userCourse) => userCourse.course),
            }));
            return {
                message: 'Successfully fetched all users info',
                statusCode: 200,
                data: transformedUsers,
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
                if (isUserExist.deletedAt) {
                    throw new Error('A previously deleted account is using this email. Restore that account or purge it before re-registering this email.');
                }
                throw new Error('User already exists in the system');
            }
            const password = await argon2.hash(body.password);
            const selfRegistered = body.selfRegistered === true;
            delete body.password;
            const user = await this.prisma.user.create({
                data: {
                    firstName: body?.firstName,
                    lastName: body?.lastName,
                    email: body?.email,
                    password,
                    phone: body.phone,
                    address: body.address ?? null,
                    role: body.role,
                    photo: body?.photo ?? null,
                    photoBase64: body?.photoBase64 ?? null,
                    mustChangePassword: !selfRegistered,
                },
            });
            delete user.password;
            if (selfRegistered && user.email) {
                try {
                    await this.mail.sendWelcome({
                        to: user.email,
                        userId: user.id,
                        firstName: user.firstName,
                    });
                }
                catch (mailErr) {
                    const m = mailErr instanceof Error ? mailErr.message : String(mailErr);
                    UserService_1.logger.warn(`Welcome email failed for user ${user.id}: ${m}`);
                }
            }
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
                    passwordChangedAt: new Date(),
                },
            });
            await this.recordPasswordChange(userId);
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
    async updatePassword(userId, body) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new Error('User not found');
            }
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    password: await argon2.hash(body.password),
                    passwordChangedAt: new Date(),
                },
            });
            await this.recordPasswordChange(userId);
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
            const user = await this.prisma.user.findFirst({
                where: { id, deletedAt: null },
            });
            if (!user?.id) {
                throw new Error('User not found');
            }
            const deletedUser = await this.prisma.user.update({
                where: { id },
                data: {
                    deletedAt: new Date(),
                    status: 'inactive',
                },
            });
            return {
                message: 'Successfully deleted user record',
                statusCode: 200,
                data: deletedUser,
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
    async gatherDeletionImpact(id) {
        const [enrollments, formCompletions, policyCompletions, policyItemCompletions, feedbackSubmissions, lastSeenSections, quizProgress, courseCompletions, favoriteThreads, threadSubscriptions, todos, contactMessages, policiesAndProcedures, notifications, assessmentAttempts, ownSubmissions, authoredNotifications, posts, postComments, forumThreads, forumComments, assignmentsCreated, assignmentsToReview, assessmentsCreated, submissionsAssignedToReview, submissionsReviewed,] = await this.prisma.$transaction([
            this.prisma.userCourse.count({ where: { userId: id } }),
            this.prisma.userFormCompletion.count({ where: { userId: id } }),
            this.prisma.userPolicyCompletion.count({ where: { userId: id } }),
            this.prisma.userPolicyItemCompletion.count({ where: { userId: id } }),
            this.prisma.courseFeedbackSubmission.count({ where: { userId: id } }),
            this.prisma.lastSeenSection.count({ where: { userId: id } }),
            this.prisma.quizProgress.count({ where: { userId: id } }),
            this.prisma.courseCompletion.count({ where: { userId: id } }),
            this.prisma.favoriteForumThread.count({ where: { userId: id } }),
            this.prisma.threadSubscription.count({ where: { userId: id } }),
            this.prisma.todoItem.count({ where: { userId: id } }),
            this.prisma.contactMessage.count({ where: { userId: id } }),
            this.prisma.policiesAndProcedures.count({ where: { userId: id } }),
            this.prisma.notification.count({ where: { userId: id } }),
            this.prisma.assessmentAttempt.count({ where: { userId: id } }),
            this.prisma.assignmentSubmission.count({ where: { studentId: id } }),
            this.prisma.notification.count({ where: { commenterId: id } }),
            this.prisma.post.count({ where: { userId: id } }),
            this.prisma.comment.count({ where: { userId: id } }),
            this.prisma.forumThread.count({ where: { userId: id } }),
            this.prisma.forumComment.count({ where: { userId: id } }),
            this.prisma.assignment.count({ where: { createdByAdminId: id } }),
            this.prisma.assignment.count({ where: { assignedToAdminId: id } }),
            this.prisma.assessment.count({ where: { createdByAdminId: id } }),
            this.prisma.assignmentSubmission.count({
                where: { assignedToAdminId: id },
            }),
            this.prisma.assignmentSubmission.count({
                where: { reviewedByAdminId: id },
            }),
        ]);
        const cascade = {
            enrollments,
            formCompletions,
            policyCompletions,
            policyItemCompletions,
            feedbackSubmissions,
            lastSeenSections,
            quizProgress,
            courseCompletions,
            favoriteThreads,
            threadSubscriptions,
            todos,
            contactMessages,
            policiesAndProcedures,
            notifications,
            assessmentAttempts,
            assignmentSubmissions: ownSubmissions,
        };
        const blockers = {
            posts,
            postComments,
            forumThreads,
            forumComments,
            assignmentsCreated,
            assignmentsToReview,
            assessmentsCreated,
            submissionsAssignedToReview,
            submissionsReviewed,
        };
        const cascadeTotal = Object.values(cascade).reduce((a, b) => a + b, 0);
        const blockerTotal = Object.values(blockers).reduce((a, b) => a + b, 0);
        return {
            commenterReferencesToUnlink: authoredNotifications,
            cascade,
            cascadeTotal,
            blockers,
            blockerTotal,
            canPurge: blockerTotal === 0,
        };
    }
    async getDeletionPreview(id) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                },
            });
            if (!user?.id) {
                throw new Error('User not found');
            }
            const impact = await this.gatherDeletionImpact(id);
            return {
                message: 'Successfully fetched user deletion preview',
                statusCode: 200,
                data: { user, ...impact },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async purgeUser(id) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id },
            });
            if (!user?.id) {
                throw new Error('User not found');
            }
            const impact = await this.gatherDeletionImpact(id);
            if (!impact.canPurge) {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'Cannot permanently delete this user because they authored content other users depend on. Reassign or remove these records first, or use a soft delete instead.',
                    blockers: impact.blockers,
                }, common_1.HttpStatus.CONFLICT);
            }
            await this.prisma.$transaction([
                this.prisma.notification.updateMany({
                    where: { commenterId: id },
                    data: { commenterId: null },
                }),
                this.prisma.courseCompletion.deleteMany({ where: { userId: id } }),
                this.prisma.assessmentAttempt.deleteMany({ where: { userId: id } }),
                this.prisma.assignmentSubmission.deleteMany({
                    where: { studentId: id },
                }),
                this.prisma.userFormCompletion.deleteMany({ where: { userId: id } }),
                this.prisma.userPolicyItemCompletion.deleteMany({
                    where: { userId: id },
                }),
                this.prisma.userPolicyCompletion.deleteMany({ where: { userId: id } }),
                this.prisma.courseFeedbackSubmission.deleteMany({
                    where: { userId: id },
                }),
                this.prisma.lastSeenSection.deleteMany({ where: { userId: id } }),
                this.prisma.quizProgress.deleteMany({ where: { userId: id } }),
                this.prisma.userChapterCompletion.deleteMany({ where: { userId: id } }),
                this.prisma.userModuleCompletion.deleteMany({ where: { userId: id } }),
                this.prisma.favoriteForumThread.deleteMany({ where: { userId: id } }),
                this.prisma.threadSubscription.deleteMany({ where: { userId: id } }),
                this.prisma.todoItem.deleteMany({ where: { userId: id } }),
                this.prisma.contactMessage.deleteMany({ where: { userId: id } }),
                this.prisma.policiesAndProcedures.deleteMany({ where: { userId: id } }),
                this.prisma.notification.deleteMany({ where: { userId: id } }),
                this.prisma.userCourse.deleteMany({ where: { userId: id } }),
                this.prisma.user.delete({ where: { id } }),
            ]);
            return {
                message: 'Successfully purged user record and associated data',
                statusCode: 200,
                data: { user, deleted: impact.cascade },
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2003') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'Cannot permanently delete this user because they still have associated records. Use a soft delete instead.',
                }, common_1.HttpStatus.CONFLICT);
            }
            else {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async createUserMessage(body, user) {
        try {
            const contactUsMessage = await this.prisma.contactMessage.create({
                data: {
                    userId: user.id,
                    message: body.message,
                    isSeen: false,
                },
            });
            try {
                const senderName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
                await this.mail.sendContactMessage({
                    to: mail_layout_1.ADMIN_EMAIL,
                    senderName: senderName || 'A user',
                    senderEmail: user.email,
                    message: body.message,
                });
            }
            catch (mailErr) {
                const m = mailErr instanceof Error ? mailErr.message : String(mailErr);
                UserService_1.logger.warn(`Contact-message email failed: ${m}`);
            }
            return {
                message: 'Successfully sent a message to admin',
                statusCode: 200,
                data: contactUsMessage,
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
    async getAllUserMessages(userId, role) {
        try {
            const users = await this.prisma.contactMessage.findMany({
                ...(role === 'user' && {
                    where: {
                        userId: userId,
                    },
                }),
                select: {
                    id: true,
                    createdAt: true,
                    isSeen: true,
                    message: true,
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true,
                        },
                    },
                },
            });
            if (!(users.length > 0)) {
                throw new Error('No Userssdsds found');
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
                error: 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
};
exports.UserService = UserService;
UserService.logger = new common_1.Logger(UserService_1.name);
exports.UserService = UserService = UserService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService])
], UserService);
//# sourceMappingURL=user.service.js.map