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
exports.CourseService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const dto_1 = require("../dto");
const prisma_service_1 = require("../prisma/prisma.service");
let CourseService = class CourseService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    assertValidOrderingItems(items, correctOrder) {
        const ids = new Set(items.map((i) => i.id));
        if (ids.size !== items.length) {
            throw new Error('Ordering items must have unique ids');
        }
        if (correctOrder.length !== ids.size) {
            throw new Error('correctOrder must list each item id exactly once');
        }
        for (const id of correctOrder) {
            if (!ids.has(id)) {
                throw new Error(`correctOrder references unknown id: ${id}`);
            }
        }
    }
    sanitizeLessonSectionForStudent(section) {
        if (section.type === dto_1.SectionType.ORDERING) {
            section.config = null;
        }
        else if (section.type === dto_1.SectionType.MATCHING) {
            const cfg = section.config;
            if (cfg?.pairs?.length) {
                const categories = this.shuffleArray(cfg.pairs.map((p) => ({ id: p.id, text: p.right })));
                section.config = {
                    pairs: cfg.pairs.map((p) => ({ id: p.id, left: p.left })),
                    categories,
                };
            }
        }
    }
    async markFormComplete(userId, courseId, formId, metadata, courseFormId) {
        return this.prisma.userFormCompletion.upsert({
            where: {
                userId_courseId_formId: {
                    userId,
                    courseId,
                    formId,
                },
            },
            create: {
                userId,
                courseId,
                formId,
                courseFormId,
                isComplete: true,
                completedAt: new Date(),
                metadata: metadata ?? {},
            },
            update: {
                isComplete: true,
                completedAt: new Date(),
                metadata: metadata ?? {},
            },
        });
    }
    async markPolicyItemAsComplete({ userId, courseId, policyId, policyItemId, }) {
        try {
            const [itemCompletion, requiredItems, completedItems] = await this.prisma.$transaction([
                this.prisma.userPolicyItemCompletion.upsert({
                    where: {
                        userId_itemId: {
                            userId,
                            itemId: policyItemId,
                        },
                    },
                    update: {
                        isComplete: true,
                        completedAt: new Date(),
                    },
                    create: {
                        userId,
                        itemId: policyItemId,
                        isComplete: true,
                        completedAt: new Date(),
                    },
                }),
                this.prisma.policyItem.findMany({
                    where: {
                        policyId,
                        isRequired: true,
                    },
                    select: { id: true },
                }),
                this.prisma.userPolicyItemCompletion.findMany({
                    where: {
                        userId,
                        itemId: {
                            in: await this.prisma.policyItem
                                .findMany({
                                where: { policyId, isRequired: true },
                                select: { id: true },
                            })
                                .then((items) => items.map((i) => i.id)),
                        },
                        isComplete: true,
                    },
                    select: { itemId: true },
                }),
            ]);
            const allRequiredItemsCompleted = requiredItems.length === completedItems.length;
            const policyCompletion = allRequiredItemsCompleted
                ? await this.prisma.userPolicyCompletion.upsert({
                    where: {
                        userId_courseId_policyId: {
                            userId,
                            courseId,
                            policyId,
                        },
                    },
                    update: {
                        isComplete: true,
                        completedAt: new Date(),
                    },
                    create: {
                        userId,
                        courseId,
                        policyId,
                        isComplete: true,
                        completedAt: new Date(),
                    },
                })
                : null;
            return {
                message: 'Policy item marked as completed' +
                    (allRequiredItemsCompleted ? ', Policy completed as well' : ''),
                statusCode: common_1.HttpStatus.OK,
                data: {
                    itemCompletion,
                    policyCompletion,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to mark policy item as completed',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async getUserPolicyCompletions({ courseId, userId }) {
        try {
            const policies = await this.prisma.policy.findMany({
                where: { courseId },
                orderBy: { order: 'asc' },
                include: {
                    items: {
                        orderBy: { order: 'asc' },
                        include: {
                            completions: {
                                where: { userId },
                                select: {
                                    isComplete: true,
                                    completedAt: true,
                                },
                            },
                        },
                    },
                    completions: {
                        where: { userId },
                        select: {
                            isComplete: true,
                            completedAt: true,
                        },
                    },
                },
            });
            const transformedPolicies = policies.map((policy) => {
                const items = policy.items.map((item) => ({
                    policyItemId: item.id,
                    title: item.title,
                    description: item.description,
                    link: item.link,
                    isRequired: item.isRequired,
                    isComplete: item.completions[0]?.isComplete || false,
                    completedAt: item.completions[0]?.completedAt || null,
                }));
                const isPolicyComplete = policy.completions[0]?.isComplete ||
                    (items.length > 0 &&
                        items.every((item) => !item.isRequired || item.isComplete));
                return {
                    policyId: policy.id,
                    title: policy.title,
                    description: policy.description,
                    isComplete: isPolicyComplete,
                    completedAt: policy.completions[0]?.completedAt || null,
                    items,
                };
            });
            const totalPolicies = policies.length;
            const completedPolicies = transformedPolicies.filter((p) => p.isComplete).length;
            const totalItems = transformedPolicies.reduce((sum, policy) => sum + policy.items.length, 0);
            const completedItems = transformedPolicies.reduce((sum, policy) => sum + policy.items.filter((item) => item.isComplete).length, 0);
            const allItems = transformedPolicies.flatMap((policy) => policy.items);
            const requiredItems = allItems.filter((item) => item.isRequired).length;
            const completedRequiredItems = allItems.filter((item) => item.isRequired && item.isComplete).length;
            return {
                totalPolicies,
                completedPolicies,
                totalItems,
                completedItems,
                requiredItems,
                completedRequiredItems,
                policies: transformedPolicies,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                error: 'Failed to fetch policy completions',
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getCourseReport(courseId, userId) {
        try {
            const [course, userDetails] = await Promise.all([
                this.prisma.course.findUnique({
                    where: { id: courseId },
                    select: {
                        id: true,
                        title: true,
                        users: {
                            where: {
                                id: userId,
                            },
                        },
                        modules: {
                            select: {
                                id: true,
                                title: true,
                                chapters: {
                                    select: {
                                        id: true,
                                        title: true,
                                        _count: {
                                            select: {
                                                UserCourseProgress: {
                                                    where: { userId },
                                                },
                                                sections: true,
                                                quizzes: true,
                                                QuizAnswer: {
                                                    where: { isAnswerCorrect: true, userId },
                                                },
                                                LastSeenSection: {
                                                    where: { userId },
                                                },
                                            },
                                        },
                                    },
                                    orderBy: {
                                        createdAt: 'asc',
                                    },
                                },
                            },
                        },
                    },
                }),
                this.prisma.user.findUnique({
                    where: {
                        id: userId,
                    },
                }),
            ]);
            let totalSectionsInCourse = 0;
            course.modules.forEach((module) => {
                module.chapters.forEach((chapter) => {
                    totalSectionsInCourse += chapter._count.sections;
                });
            });
            course.modules.forEach((module) => {
                module.chapters.forEach((chapter) => {
                    const userCourseProgress = chapter._count.UserCourseProgress;
                    const totalSectionsInChapter = chapter._count.sections;
                    const progress = (userCourseProgress * 100) / totalSectionsInChapter;
                    const contribution = (userCourseProgress * 100) / totalSectionsInCourse;
                    chapter.progress = progress.toFixed(2);
                    chapter.contribution = contribution.toFixed(2);
                });
            });
            return {
                message: 'Successfully retrieved datas',
                statusCode: 200,
                data: course.modules,
                user: userDetails,
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
    async getCourseDates(courseId, userId) {
        try {
            const allProgressItem = await this.prisma.UserCourseProgress.findMany({
                where: {
                    courseId,
                    userId,
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
            const courseStartDate = allProgressItem?.[0]?.createdAt;
            return {
                message: 'Successfully retrieved datas',
                statusCode: 200,
                data: { courseStartDate },
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
    async deletePostComment(postId, commentId) {
        try {
            const post = await this.prisma.comment.findUnique({
                where: { id: commentId, postId },
            });
            if (!post) {
                throw new Error('Post not found');
            }
            await this.prisma.comment.delete({
                where: { id: commentId, postId },
            });
            return {
                message: 'Successfully deleted post comment record',
                statusCode: 200,
                data: post,
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async getPostComments(postId) {
        try {
            const postComments = await this.prisma.comment.findMany({
                where: {
                    postId: postId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully retrieved data',
                statusCode: 200,
                data: postComments,
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
    async createPostComment(postId, userId, body) {
        try {
            const comment = await this.prisma.comment.create({
                data: {
                    content: body.content,
                    postId: postId,
                    userId,
                },
            });
            return {
                message: 'Successfully created post comment record',
                statusCode: 200,
                data: comment,
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
    async updatePostComment(postId, commentId, body) {
        try {
            const doesCommentExist = await this.prisma.comment.findUnique({
                where: { id: commentId, postId },
            });
            if (!doesCommentExist) {
                throw new Error('Comment does not exist');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updatePost = {};
            for (const [key, value] of Object.entries(body)) {
                updatePost[key] = value;
            }
            const updatedPostComment = await this.prisma.comment.update({
                where: { id: commentId, postId },
                data: updatePost,
            });
            return {
                message: 'Successfully updated post record',
                statusCode: 200,
                data: updatedPostComment,
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
    async deletePost(id) {
        try {
            const post = await this.prisma.post.findUnique({
                where: { id },
            });
            if (!post) {
                throw new Error('Post not found');
            }
            await this.prisma.post.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted post record',
                statusCode: 200,
                data: post,
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async getPost(postId) {
        try {
            const posts = await this.prisma.post.findUnique({
                where: {
                    id: postId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully retrieved data',
                statusCode: 200,
                data: posts,
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
    async getAllPosts(courseId) {
        try {
            const posts = await this.prisma.post.findMany({
                where: {
                    courseId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    comments: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
            return {
                message: 'Successfully fetch all posts',
                statusCode: 200,
                data: posts,
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
    async createPost(courseId, userId, body) {
        try {
            const post = await this.prisma.post.create({
                data: {
                    title: body.title,
                    content: body.content,
                    courseId: courseId,
                    userId,
                },
            });
            return {
                message: 'Successfully create post record',
                statusCode: 200,
                data: post,
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
    async createPolicies(userId, body) {
        try {
            const isCourseExist = await this.prisma.policiesAndProcedures.findUnique({
                where: { policiesId: body.policiesId },
            });
            if (isCourseExist) {
                throw new Error('Course already exist with specified title');
            }
            const policiesAndProcedures = await this.prisma.policiesAndProcedures.create({
                data: {
                    policiesId: body?.policiesId,
                    userId,
                },
            });
            return {
                message: 'Successfully updated record',
                statusCode: 200,
                data: policiesAndProcedures,
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
    async getUserPolicies(userId) {
        try {
            const policiesAndProcedures = await this.prisma.policiesAndProcedures.findMany({
                where: {
                    userId,
                },
            });
            return {
                message: 'Record fetched successfully',
                statusCode: 200,
                data: policiesAndProcedures,
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
    async deletePolicies() {
        try {
            const user = await this.prisma.policiesAndProcedures.deleteMany();
            return {
                message: 'Successfully deleted policies record',
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
    async updatePost(id, body) {
        try {
            const isPostExist = await this.prisma.post.findUnique({
                where: { id: id },
            });
            if (!isPostExist) {
                throw new Error('Post does not exist');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updatePost = {};
            for (const [key, value] of Object.entries(body)) {
                updatePost[key] = value;
            }
            const updatedPost = await this.prisma.post.update({
                where: { id },
                data: updatePost,
            });
            return {
                message: 'Successfully updated post record',
                statusCode: 200,
                data: updatedPost,
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
    async createCourse(body) {
        try {
            const isCourseExist = await this.prisma.course.findUnique({
                where: { title: body.title },
            });
            if (isCourseExist) {
                throw new Error('Course already exist with specified title');
            }
            const result = await this.prisma.$transaction(async (prisma) => {
                const course = await prisma.course.create({
                    data: {
                        title: body.title,
                        description: body.description,
                        assessment: body.assessment,
                        duration: body.duration,
                        overview: body.overview,
                        image: body.image,
                        syllabusOverview: body.syllabusOverview,
                        resourcesOverview: body.resourcesOverview,
                        tutorInfo: body.tutorInfo,
                        assessments: body.assessments,
                        resources: body.resources,
                        syllabus: body.syllabus,
                        price: body.price,
                    },
                });
                if (body.courseForms && body.courseForms.length > 0) {
                    await prisma.courseForm.createMany({
                        data: body.courseForms.map((form) => ({
                            courseId: course.id,
                            formId: form.value,
                            formName: form.label,
                            isRequired: form.isRequired ?? true,
                        })),
                    });
                }
                if (body.feedbackForm) {
                    await prisma.courseFeedbackForm.create({
                        data: {
                            courseId: course.id,
                            formName: body.feedbackForm.formName || 'Course Completion Feedback',
                            formStructure: body.feedbackForm.formStructure || {},
                            isRequired: body.feedbackForm.isRequired,
                        },
                    });
                }
                return course;
            });
            return {
                message: 'Successfully created course record with forms',
                statusCode: 200,
                data: result,
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
    async createModule(body) {
        try {
            const module = await this.prisma.module.create({
                data: {
                    title: body.title,
                    description: body.description,
                    courseId: body.id,
                },
            });
            return {
                message: 'Successfully create module record',
                statusCode: 200,
                data: module,
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
    async createChapter(body) {
        try {
            const chapter = await this.prisma.chapter.create({
                data: {
                    title: body.title,
                    description: body.description,
                    pdfFile: body.pdfFile,
                    moduleId: body.id,
                },
            });
            return {
                message: 'Successfully create chapter record',
                statusCode: 200,
                data: chapter,
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
    async createSection(body) {
        try {
            const data = {
                title: body.title,
                description: body.description,
                shortDescription: body.shortDescription ?? '',
                type: body.type || dto_1.SectionType.DEFAULT,
                chapterId: body.chapterId || body.id,
                moduleId: body.moduleId,
                orderIndex: body.orderIndex || null,
            };
            if (body.type === dto_1.SectionType.MATCH_AND_LEARN) {
                const matchData = body;
                const categories = matchData.categories || [
                    ...new Set(matchData.items.map((item) => item.correctCategory)),
                ];
                data.itemLabel = matchData.itemLabel;
                data.categoryLabel = matchData.categoryLabel;
                data.categories = categories;
                data.maxPerCategory = matchData.maxPerCategory || 1;
                data.isActive = matchData.isActive ?? true;
                data.items = matchData.items;
            }
            if (body.type === dto_1.SectionType.VISUAL_ACTIVITY) {
                const visualData = body;
                const hasCorrectOption = visualData.options.some((option) => option.isCorrect === true);
                if (!hasCorrectOption) {
                    throw new Error('At least one option must be marked as correct for Visual Activity sections');
                }
                data.questionText = visualData.questionText;
                data.imageUrl = visualData.imageUrl || null;
                data.allowMultipleSelection =
                    visualData.allowMultipleSelection ?? false;
                data.options = visualData.options;
            }
            if (body.type === dto_1.SectionType.ORDERING) {
                const ord = body;
                this.assertValidOrderingItems(ord.items, ord.correctOrder);
                data.type = dto_1.SectionType.ORDERING;
                data.questionText = ord.questionText ?? null;
                data.items = ord.items;
                data.config = {
                    correctOrder: ord.correctOrder,
                };
            }
            if (body.type === dto_1.SectionType.MATCHING) {
                const mat = body;
                const ids = new Set(mat.pairs.map((p) => p.id));
                if (ids.size !== mat.pairs.length) {
                    throw new Error('Matching pairs must have unique ids');
                }
                data.type = dto_1.SectionType.MATCHING;
                data.questionText = mat.questionText ?? null;
                data.config = { pairs: mat.pairs };
            }
            const section = await this.prisma.section.create({
                data,
            });
            return {
                message: 'Successfully create section record',
                statusCode: 200,
                data: section,
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
    async getCourse(id) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id },
                include: {
                    courseForms: true,
                    Policy: {
                        include: {
                            items: true,
                        },
                    },
                    feedbackForm: true,
                },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            return {
                message: 'Successfully fetched course info',
                statusCode: 200,
                data: {
                    ...course,
                    CoursePolicy: course.Policy?.flatMap((policy) => ({
                        id: policy.id,
                        courseId: policy.courseId,
                        title: policy.title,
                        description: policy.description,
                        link: policy.items?.[0]?.link,
                        isRequired: true,
                        order: policy.order,
                        createdAt: policy.createdAt,
                        updatedAt: policy.updatedAt,
                    })) || [],
                    feedbackForm: course.feedbackForm
                        ? {
                            id: course.feedbackForm.id,
                            formName: course.feedbackForm.formName,
                            formStructure: course.feedbackForm.formStructure,
                            isRequired: course.feedbackForm.isRequired,
                            isActive: course.feedbackForm.isActive,
                        }
                        : null,
                },
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
    async canAccessCourseContent(userId, courseId) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
                include: {
                    users: {
                        where: { userId },
                        select: { id: true },
                    },
                },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            if (course.users.length === 0) {
                return {
                    message: 'User is not assigned to this course',
                    statusCode: 403,
                    data: { canAccessContent: false },
                };
            }
            const [forms, policies, policyCompletions, policyItemCompletions] = await Promise.all([
                this.prisma.courseForm.findMany({
                    where: {
                        courseId,
                        isRequired: true,
                    },
                    include: {
                        userFormCompletions: {
                            where: { userId },
                            select: { isComplete: true },
                        },
                    },
                }),
                this.prisma.policy.findMany({
                    where: { courseId },
                    include: {
                        items: {
                            where: { isRequired: true },
                            select: { id: true },
                        },
                    },
                }),
                this.prisma.userPolicyCompletion.findMany({
                    where: {
                        userId,
                        courseId,
                        isComplete: true,
                    },
                    select: { policyId: true },
                }),
                this.prisma.userPolicyItemCompletion.findMany({
                    where: {
                        userId,
                        isComplete: true,
                        item: {
                            policy: {
                                courseId,
                            },
                            isRequired: true,
                        },
                    },
                    select: { itemId: true },
                }),
            ]);
            const totalRequiredForms = forms.length;
            let completedForms = 0;
            const formStatus = forms.map((form) => {
                const isComplete = form.userFormCompletions[0]?.isComplete || false;
                if (isComplete)
                    completedForms++;
                return {
                    formId: form.formId,
                    formName: form.formName,
                    isRequired: form.isRequired,
                    isComplete,
                };
            });
            const totalRequiredPolicies = policies.length;
            const completedPolicies = policyCompletions.length;
            const totalRequiredPolicyItems = policies.reduce((sum, policy) => sum + (policy.items?.length || 0), 0);
            const completedPolicyItems = policyItemCompletions.length;
            const detailedPolicies = await this.prisma.policy.findMany({
                where: { courseId },
                include: {
                    items: {
                        include: {
                            completions: {
                                where: { userId },
                                select: { isComplete: true },
                            },
                        },
                    },
                    completions: {
                        where: { userId },
                        select: { isComplete: true },
                    },
                },
            });
            const policyStatus = detailedPolicies.map((policy) => ({
                policyId: policy.id,
                title: policy.title,
                description: policy.description,
                isComplete: policy.completions[0]?.isComplete || false,
                items: policy.items.map((item) => ({
                    itemId: item.id,
                    title: item.title,
                    description: item.description,
                    link: item.link,
                    isRequired: item.isRequired,
                    isComplete: item.completions[0]?.isComplete || false,
                })),
            }));
            const canAccessContent = completedForms === totalRequiredForms &&
                completedPolicyItems === totalRequiredPolicyItems;
            return {
                message: 'Course access status retrieved',
                statusCode: 200,
                data: {
                    canAccessContent,
                    formStatus: {
                        completedForms,
                        totalForms: totalRequiredForms,
                        forms: formStatus,
                    },
                    policyStatus: {
                        completedPolicies,
                        totalPolicies: totalRequiredPolicies,
                        completedPolicyItems,
                        totalPolicyItems: totalRequiredPolicyItems,
                        policies: policyStatus,
                    },
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                error: error?.message || 'Failed to check course access',
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR, {
                cause: error,
            });
        }
    }
    async getCourseDetailPublic(id) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    image: true,
                    price: true,
                    modules: {
                        select: {
                            id: true,
                            title: true,
                            chapters: {
                                orderBy: {
                                    createdAt: 'asc',
                                },
                            },
                            _count: true,
                        },
                        orderBy: {
                            createdAt: 'asc',
                        },
                    },
                },
            });
            if (!course) {
                throw new Error('course not found');
            }
            return {
                message: 'Successfully fetch Course info',
                statusCode: 200,
                data: course,
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
    async getModule(id) {
        try {
            const module = await this.prisma.module.findUnique({ where: { id } });
            if (!module) {
                throw new Error('Module not found');
            }
            return {
                message: 'Successfully fetch module info',
                statusCode: 200,
                data: module,
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
    async getChapter(id) {
        try {
            const chapter = await this.prisma.chapter.findUnique({ where: { id } });
            if (!chapter) {
                throw new Error('Chapter not found');
            }
            return {
                message: 'Successfully fetch Chapter info',
                statusCode: 200,
                data: chapter,
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
    async getSection(id) {
        try {
            const section = await this.prisma.section.findUnique({ where: { id } });
            if (!section) {
                throw new Error('section not found');
            }
            return {
                message: 'Successfully fetch section info',
                statusCode: 200,
                data: section,
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
    async getAllCourses() {
        try {
            const courses = await this.prisma.course.findMany({
                include: {
                    _count: {
                        select: {
                            modules: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
            if (!(courses.length > 0)) {
                throw new Error('No Courses found');
            }
            return {
                message: 'Successfully fetched all Courses with form information',
                statusCode: 200,
                data: courses,
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
    async getAllPublicCourses() {
        try {
            const courses = await this.prisma.course.findMany({
                include: {
                    _count: {
                        select: {
                            modules: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
            if (!(courses.length > 0)) {
                return {
                    message: 'Successfully fetch all Courses info',
                    statusCode: 200,
                    data: [],
                };
            }
            return {
                message: 'Successfully fetch all Courses info',
                statusCode: 200,
                data: courses,
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
    async getAllModules(id) {
        try {
            const modules = await this.prisma.module.findMany({
                where: {
                    courseId: id,
                },
                include: {
                    _count: {
                        select: {
                            chapters: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
            if (!(modules.length > 0)) {
                throw new Error('No Modules found');
            }
            return {
                message: 'Successfully fetch all Modules info against course',
                statusCode: 200,
                data: modules,
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
    async getAllUserModules(id, userId) {
        try {
            const courses = await this.prisma.course.findFirst({
                where: { id },
                select: {
                    id: true,
                    title: true,
                    modules: {
                        select: {
                            id: true,
                            title: true,
                            chapters: {
                                select: {
                                    id: true,
                                    title: true,
                                    _count: {
                                        select: {
                                            UserCourseProgress: {
                                                where: { userId },
                                            },
                                            sections: true,
                                        },
                                    },
                                    QuizProgress: {
                                        where: { userId },
                                    },
                                },
                                orderBy: {
                                    createdAt: 'asc',
                                },
                            },
                            _count: {
                                select: {
                                    UserCourseProgress: {
                                        where: { userId },
                                    },
                                    sections: true,
                                },
                            },
                        },
                    },
                },
            });
            return {
                message: 'Successfully fetched all Modules info against course',
                statusCode: 200,
                data: courses?.modules,
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
    async getAllChapters(id) {
        try {
            const chapters = await this.prisma.chapter.findMany({
                where: {
                    moduleId: id,
                },
                include: {
                    _count: {
                        select: {
                            sections: true,
                            quizzes: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
            return {
                message: 'Successfully fetch all Chapters info against module',
                statusCode: 200,
                data: chapters,
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
    async getAllSections(id) {
        try {
            const sections = await this.prisma.section.findMany({
                where: {
                    chapterId: id,
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
            sections.sort((a, b) => {
                const aOrder = a.orderIndex;
                const bOrder = b.orderIndex;
                if (aOrder === null && bOrder === null)
                    return 0;
                if (aOrder === null)
                    return 1;
                if (bOrder === null)
                    return -1;
                return aOrder - bOrder;
            });
            return {
                message: 'Successfully fetch all Sections info against chapter',
                statusCode: 200,
                data: sections,
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
    async getAllUserSections(id, userId, courseId) {
        try {
            const [sections, userCourseProgress, chapter, lastSeenLesson] = await Promise.all([
                this.prisma.section.findMany({
                    where: { chapterId: id },
                    orderBy: {
                        createdAt: 'asc',
                    },
                }),
                this.prisma.userCourseProgress.findMany({
                    where: { userId, courseId, chapterId: id },
                }),
                this.prisma.chapter.findUnique({
                    where: { id },
                    include: {
                        quizzes: {
                            select: {
                                id: true,
                                question: true,
                                options: true,
                                answer: true,
                            },
                        },
                    },
                }),
                this.prisma.lastSeenSection.findUnique({
                    where: { userId_chapterId: { userId, chapterId: id } },
                }),
            ]);
            const sortedSections = [...sections].sort((a, b) => {
                const aOrder = a.orderIndex;
                const bOrder = b.orderIndex;
                if (aOrder === null && bOrder === null)
                    return 0;
                if (aOrder === null)
                    return 1;
                if (bOrder === null)
                    return -1;
                return aOrder - bOrder;
            });
            const allSections = sortedSections?.length > 0 ? [...sortedSections] : [];
            const completedSections = userCourseProgress?.length > 0 ? [...userCourseProgress] : [];
            allSections?.forEach((section) => {
                const isCompleted = completedSections?.some((completedSection) => completedSection.sectionId === section.id);
                section.isLastSeen =
                    lastSeenLesson?.sectionId === section.id ? true : false;
                section.isCompleted = isCompleted;
                if (section.type === dto_1.SectionType.ORDERING ||
                    section.type === dto_1.SectionType.MATCHING) {
                    this.sanitizeLessonSectionForStudent(section);
                }
            });
            if (!(sections.length > 0)) {
                throw new Error('No Sections found');
            }
            return {
                message: 'Successfully fetch all Sections info against chapter',
                statusCode: 200,
                data: allSections,
                chapter: chapter,
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
    async updateCourse(id, body) {
        try {
            const course = await this.prisma.course.findUnique({ where: { id } });
            if (!course) {
                throw new Error('Course does not exist');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('No update data provided');
            }
            const { courseForms, policies, feedbackForm, ...courseData } = body;
            const updatedCourse = await this.prisma.course.update({
                where: { id },
                data: courseData,
            });
            if (courseForms) {
                await this.prisma.courseForm.deleteMany({ where: { courseId: id } });
                if (courseForms.length > 0) {
                    await this.prisma.courseForm.createMany({
                        data: courseForms.map((form) => ({
                            courseId: id,
                            formId: form.value,
                            formName: form.label,
                            isRequired: form.isRequired ?? true,
                        })),
                    });
                }
            }
            if (feedbackForm) {
                await this.prisma.courseFeedbackSubmission.deleteMany({
                    where: {
                        courseId: id,
                    },
                });
                await this.prisma.courseFeedbackForm.deleteMany({
                    where: {
                        courseId: id,
                    },
                });
                await this.prisma.courseFeedbackForm.create({
                    data: {
                        courseId: id,
                        formName: feedbackForm.formName || 'Course Completion Feedback',
                        formStructure: feedbackForm.formStructure || {},
                        isRequired: feedbackForm.isRequired,
                    },
                });
            }
            if (policies) {
                await this.prisma.userPolicyItemCompletion.deleteMany({
                    where: { item: { policy: { courseId: id } } },
                });
                await this.prisma.userPolicyCompletion.deleteMany({
                    where: { policy: { courseId: id } },
                });
                await this.prisma.policyItem.deleteMany({
                    where: { policy: { courseId: id } },
                });
                await this.prisma.policy.deleteMany({
                    where: { courseId: id },
                });
                for (const policy of policies) {
                    await this.prisma.policy.create({
                        data: {
                            courseId: id,
                            title: policy.title,
                            description: policy.description,
                            order: policy.order ?? 0,
                            items: {
                                create: policy.items?.map((item, index) => ({
                                    title: item.title,
                                    description: item.description ?? '',
                                    link: item.link,
                                    isRequired: item.isRequired ?? true,
                                    order: item.order ?? index,
                                })),
                            },
                        },
                    });
                }
            }
            return {
                message: 'Successfully updated course record with forms and policies',
                statusCode: 200,
                data: updatedCourse,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong while updating the course',
            }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async updateModule(id, body) {
        try {
            const isModuleExist = await this.prisma.module.findUnique({
                where: { id: id },
            });
            if (!isModuleExist) {
                throw new Error('Module already exist with specified title');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateModule = {};
            for (const [key, value] of Object.entries(body)) {
                updateModule[key] = value;
            }
            const updatedModule = await this.prisma.module.update({
                where: { id },
                data: updateModule,
            });
            return {
                message: 'Successfully updated module record',
                statusCode: 200,
                data: updatedModule,
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
    async updateChapter(id, body) {
        try {
            const isChapterExist = await this.prisma.chapter.findUnique({
                where: { id: id },
            });
            if (!isChapterExist) {
                throw new Error('Chapter already exist with specified title');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateChapter = {};
            for (const [key, value] of Object.entries(body)) {
                updateChapter[key] = value;
            }
            const updatedChapter = await this.prisma.chapter.update({
                where: { id },
                data: updateChapter,
            });
            return {
                message: 'Successfully updated chapter record',
                statusCode: 200,
                data: updatedChapter,
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
    async updateSection(id, body) {
        try {
            const isSectionExist = await this.prisma.section.findUnique({
                where: { id: id },
            });
            if (!isSectionExist) {
                throw new Error('Section does not exist');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateData = {};
            if (body.title !== undefined)
                updateData.title = body.title;
            if (body.description !== undefined)
                updateData.description = body.description;
            if (body.shortDescription !== undefined)
                updateData.shortDescription = body.shortDescription;
            if (body.chapterId !== undefined)
                updateData.chapterId = body.chapterId;
            if (body.moduleId !== undefined)
                updateData.moduleId = body.moduleId;
            if (body.orderIndex !== undefined)
                updateData.orderIndex = body.orderIndex;
            if (body.type !== undefined)
                updateData.type = body.type;
            const sectionType = isSectionExist.type;
            if (sectionType === dto_1.SectionType.MATCH_AND_LEARN ||
                body.type === dto_1.SectionType.MATCH_AND_LEARN) {
                const matchData = body;
                if (matchData.itemLabel !== undefined)
                    updateData.itemLabel = matchData.itemLabel;
                if (matchData.categoryLabel !== undefined)
                    updateData.categoryLabel = matchData.categoryLabel;
                if (matchData.maxPerCategory !== undefined)
                    updateData.maxPerCategory = matchData.maxPerCategory;
                if (matchData.isActive !== undefined)
                    updateData.isActive = matchData.isActive;
                if (matchData.items !== undefined) {
                    updateData.items = matchData.items;
                    if (matchData.categories === undefined) {
                        updateData.categories = [
                            ...new Set(matchData.items.map((item) => item.correctCategory)),
                        ];
                    }
                    else {
                        updateData.categories = matchData.categories;
                    }
                }
                else if (matchData.categories !== undefined) {
                    updateData.categories = matchData.categories;
                }
            }
            if (sectionType === dto_1.SectionType.VISUAL_ACTIVITY ||
                body.type === dto_1.SectionType.VISUAL_ACTIVITY) {
                const visualData = body;
                if (visualData.questionText !== undefined)
                    updateData.questionText = visualData.questionText;
                if (visualData.imageUrl !== undefined)
                    updateData.imageUrl = visualData.imageUrl;
                if (visualData.allowMultipleSelection !== undefined)
                    updateData.allowMultipleSelection = visualData.allowMultipleSelection;
                if (visualData.options !== undefined) {
                    const hasCorrectOption = visualData.options.some((option) => option.isCorrect === true);
                    if (!hasCorrectOption) {
                        throw new Error('At least one option must be marked as correct for Visual Activity sections');
                    }
                    updateData.options = visualData.options;
                }
            }
            if (sectionType === dto_1.SectionType.ORDERING ||
                body.type === dto_1.SectionType.ORDERING) {
                const ord = body;
                if (ord.questionText !== undefined)
                    updateData.questionText = ord.questionText;
                if (ord.items !== undefined)
                    updateData.items = ord.items;
                if (ord.items !== undefined || ord.correctOrder !== undefined) {
                    const items = ord.items ??
                        (Array.isArray(isSectionExist.items)
                            ? isSectionExist.items
                            : null);
                    const existingCfg = isSectionExist.config;
                    const correctOrder = ord.correctOrder ?? existingCfg?.correctOrder ?? null;
                    if (!items?.length || !correctOrder?.length) {
                        throw new Error('ORDERING section update requires existing items and correctOrder, or provide both in the request');
                    }
                    this.assertValidOrderingItems(items, correctOrder);
                    updateData.config = {
                        correctOrder,
                    };
                }
            }
            if (sectionType === dto_1.SectionType.MATCHING ||
                body.type === dto_1.SectionType.MATCHING) {
                const mat = body;
                if (mat.questionText !== undefined)
                    updateData.questionText = mat.questionText;
                if (mat.pairs !== undefined) {
                    const ids = new Set(mat.pairs.map((p) => p.id));
                    if (ids.size !== mat.pairs.length) {
                        throw new Error('Matching pairs must have unique ids');
                    }
                    updateData.config = {
                        pairs: mat.pairs,
                    };
                }
            }
            if (Object.keys(updateData).length === 0) {
                for (const [key, value] of Object.entries(body)) {
                    updateData[key] = value;
                }
            }
            const updatedSection = await this.prisma.section.update({
                where: { id },
                data: updateData,
            });
            return {
                message: 'Successfully update section record',
                statusCode: 200,
                data: updatedSection,
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
    async updateSectionOrder(body) {
        try {
            const sectionIds = body.sections.map((s) => s.id);
            const sections = await this.prisma.section.findMany({
                where: {
                    id: { in: sectionIds },
                    chapterId: body.chapterId,
                },
            });
            if (sections.length !== sectionIds.length) {
                throw new Error('Some sections not found or do not belong to the specified chapter');
            }
            const updatePromises = body.sections.map((sectionOrder) => this.prisma.section.update({
                where: { id: sectionOrder.id },
                data: { orderIndex: sectionOrder.orderIndex },
            }));
            await this.prisma.$transaction(updatePromises);
            return {
                message: 'Successfully updated section order',
                statusCode: 200,
                data: { chapterId: body.chapterId, updatedCount: body.sections.length },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: error?.message || 'Failed to update section order',
            }, common_1.HttpStatus.BAD_REQUEST, {
                cause: error,
            });
        }
    }
    async deleteCourse(id) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            await this.prisma.course.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted course record',
                statusCode: 200,
                data: course,
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async deleteModule(id) {
        try {
            const user = await this.prisma.module.findUnique({
                where: { id },
            });
            if (!user) {
                throw new Error('Module not found');
            }
            await this.prisma.module.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted module record',
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async deleteChapter(id) {
        try {
            const user = await this.prisma.chapter.findUnique({
                where: { id },
            });
            if (!user) {
                throw new Error('Chapter not found');
            }
            await this.prisma.chapter.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted chapter record',
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async deleteSection(id) {
        try {
            const section = await this.prisma.section.findUnique({
                where: { id },
            });
            if (!section) {
                throw new Error('Section not found');
            }
            const dependentRecords = await this.prisma.lastSeenSection.findMany({
                where: { sectionId: id },
            });
            await Promise.all(dependentRecords.map(async (record) => {
                await this.prisma.lastSeenSection.delete({
                    where: { id: record.id },
                });
            }));
            await this.prisma.section.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted section record',
                statusCode: 200,
                data: section,
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async assignCourse(userId, courseId) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const existingAssignment = await this.prisma.userCourse.findUnique({
                where: {
                    userId_courseId: {
                        userId,
                        courseId,
                    },
                },
            });
            if (existingAssignment) {
                throw new Error('Course already assigned to the user');
            }
            await this.prisma.userCourse.create({
                data: {
                    userId,
                    courseId,
                    isActive: false,
                    isPaid: false,
                },
            });
            return {
                message: 'Successfully assigned course to user',
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
    async assignCoursePublic(userId, courseId) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('course not found');
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('user not found');
            }
            await this.prisma.userCourse.create({
                data: {
                    userId,
                    courseId,
                    isActive: false,
                    isPaid: false,
                },
            });
            return {
                message: 'Successfully assigned course to user',
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
    async unAssignCourse(userId, courseId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const userCourse = await this.prisma.userCourse.findFirst({
                where: { userId, courseId },
            });
            if (!userCourse) {
                throw new Error('User is not assigned to this course');
            }
            await this.prisma.userCourse.delete({
                where: {
                    id: userCourse.id,
                },
            });
            return {
                message: 'Successfully unassigned course from user',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to unassign course from user',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async toggleCourseStatus(userId, courseId, isActive) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const userCourse = await this.prisma.userCourse.findFirst({
                where: { userId, courseId },
            });
            if (!userCourse) {
                throw new Error('User is not assigned to this course');
            }
            await this.prisma.userCourse.update({
                where: { id: userCourse.id },
                data: { isActive },
            });
            return {
                message: `Successfully ${isActive ? 'activated' : 'deactivated'} course status for user`,
                statusCode: 200,
                data: {
                    userId,
                    courseId,
                    isActive,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message ||
                    `Failed to ${isActive ? 'activate' : 'deactivate'} course status`,
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async toggleCoursePaymentStatus(userId, courseId, isPaid) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const userCourse = await this.prisma.userCourse.findFirst({
                where: { userId, courseId },
            });
            if (!userCourse) {
                throw new Error('User is not assigned to this course');
            }
            await this.prisma.userCourse.update({
                where: { id: userCourse.id },
                data: { isPaid },
            });
            return {
                message: `Successfully ${isPaid ? 'activated' : 'deactivated'} course payment status for user`,
                statusCode: 200,
                data: {
                    userId,
                    courseId,
                    isPaid,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message ||
                    `Failed to ${isPaid ? 'activate' : 'deactivate'} course payment status`,
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAllAssignedCourses(userId, role) {
        try {
            const whereCondition = role === 'user' ? { userId, isActive: true } : { userId };
            const assignedCourses = await this.prisma.userCourse.findMany({
                where: whereCondition,
                include: {
                    course: {
                        include: {
                            courseForms: {
                                include: {
                                    userFormCompletions: {
                                        where: { userId },
                                        select: { isComplete: true },
                                    },
                                },
                            },
                            Policy: {
                                include: {
                                    completions: {
                                        where: { userId },
                                        select: { isComplete: true },
                                    },
                                    items: {
                                        where: { isRequired: true },
                                        include: {
                                            completions: {
                                                where: { userId },
                                                select: { isComplete: true },
                                            },
                                        },
                                    },
                                },
                            },
                            modules: {
                                select: {
                                    chapters: {
                                        select: {
                                            _count: { select: { sections: true } },
                                        },
                                    },
                                },
                            },
                            _count: { select: { UserCourseProgress: { where: { userId } } } },
                            LastSeenSection: {
                                where: { userId },
                                take: 1,
                                orderBy: { updatedAt: 'desc' },
                                include: {
                                    section: { select: { title: true } },
                                },
                            },
                        },
                    },
                },
            });
            if (!assignedCourses.length) {
                return {
                    message: 'Successfully retrieved assigned courses',
                    statusCode: 200,
                    data: [],
                };
            }
            const coursesWithDetails = assignedCourses.map((userCourse) => {
                const { course, isActive, isPaid } = userCourse;
                const formStatus = {
                    totalForms: course.courseForms?.length || 0,
                    completedForms: course.courseForms?.filter((form) => form.userFormCompletions?.some((uc) => uc.isComplete)).length || 0,
                    forms: course.courseForms?.map((form) => ({
                        courseFormId: form.id,
                        formId: form.formId,
                        formName: form.formName,
                        isRequired: form.isRequired,
                        isComplete: form.userFormCompletions?.some((uc) => uc.isComplete) || false,
                    })) || [],
                };
                const requiredPolicies = course.Policy || [];
                const allRequiredPoliciesCompleted = requiredPolicies.every((policy) => policy.completions?.some((uc) => uc.isComplete));
                const allRequiredItems = requiredPolicies.flatMap((policy) => policy.items?.filter((item) => item.isRequired) || []);
                const allRequiredItemsCompleted = allRequiredItems.every((item) => item.completions?.some((uc) => uc.isComplete));
                const policyStatus = {
                    totalPolicies: requiredPolicies.length,
                    completedPolicies: requiredPolicies.filter((policy) => policy.completions?.some((uc) => uc.isComplete)).length || 0,
                    policies: requiredPolicies.map((policy) => ({
                        policyId: policy.id,
                        title: policy.title,
                        description: policy.description,
                        isComplete: policy.completions?.some((uc) => uc.isComplete) || false,
                        items: policy.items?.map((item) => ({
                            itemId: item.id,
                            title: item.title,
                            description: item.description,
                            link: item.link,
                            isRequired: item.isRequired,
                            isComplete: item.completions?.some((uc) => uc.isComplete) || false,
                        })) || [],
                    })) || [],
                };
                const sectionsCount = course.modules
                    ?.flatMap((module) => module.chapters)
                    ?.reduce((acc, chapter) => acc + chapter._count.sections, 0) || 0;
                const userCourseProgressCount = course._count?.UserCourseProgress || 0;
                const latestLastSeenSection = course.LastSeenSection?.[0];
                const formsCompleted = formStatus.totalForms === formStatus.completedForms;
                const canAccessPolicies = formsCompleted;
                const canAccessContent = formsCompleted &&
                    allRequiredItemsCompleted;
                console.log({
                    allRequiredPoliciesCompleted,
                    allRequiredItemsCompleted,
                    requiredPolicies,
                });
                return {
                    ...course,
                    isActive,
                    isPaid,
                    percentage: sectionsCount > 0
                        ? (userCourseProgressCount * 100) / sectionsCount
                        : 0,
                    _count: {
                        totalSections: sectionsCount,
                        userCourseProgress: userCourseProgressCount,
                    },
                    formStatus,
                    policyStatus,
                    policyItemStatus: {
                        totalItems: allRequiredItems.length,
                        completedItems: allRequiredItems.filter((item) => item.completions?.some((uc) => uc.isComplete)).length,
                    },
                    canAccessPolicies,
                    canAccessContent,
                    latestLastSeenSection: latestLastSeenSection
                        ? {
                            id: latestLastSeenSection.id,
                            userId: latestLastSeenSection.userId,
                            chapterId: latestLastSeenSection.chapterId,
                            moduleId: latestLastSeenSection.moduleId,
                            sectionId: latestLastSeenSection.sectionId,
                            createdAt: latestLastSeenSection.createdAt,
                            updatedAt: latestLastSeenSection.updatedAt,
                            title: latestLastSeenSection.section.title,
                        }
                        : null,
                };
            });
            return {
                message: 'Successfully retrieved assigned courses with status',
                statusCode: 200,
                data: coursesWithDetails,
            };
        }
        catch (error) {
            console.error(error);
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAllAssignedCoursesPublic(userId) {
        try {
            const assignedCourses = await this.prisma.userCourse.findMany({
                where: { userId },
                include: {
                    course: {
                        select: {
                            id: true,
                            title: true,
                            price: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully retrieved assigned courses',
                statusCode: 200,
                data: assignedCourses,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async updateUserChapterProgress(userId, body) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: body.courseId },
                include: { modules: true },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('user not found');
            }
            let userCourseProgress = await this.prisma.userCourseProgress.findFirst({
                where: {
                    userId: userId,
                    courseId: body.courseId,
                    chapterId: body.chapterId,
                    sectionId: body.sectionId,
                    moduleId: body.moduleId,
                },
            });
            if (!userCourseProgress) {
                userCourseProgress = await this.prisma.userCourseProgress.create({
                    data: {
                        userId: userId,
                        courseId: body.courseId,
                        chapterId: body.chapterId,
                        sectionId: body.sectionId,
                        moduleId: body.moduleId,
                    },
                });
            }
            return {
                message: 'User course progress updated successfully',
                statusCode: 200,
                data: {
                    userCourseProgress,
                },
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
    async getUserChapterProgress(userId, courseId, chapterId) {
        try {
            const userCourseProgress = await this.prisma.userCourseProgress.findMany({
                where: {
                    userId,
                    courseId,
                    chapterId,
                },
            });
            const module = await this.prisma.module.findFirst({
                where: {
                    courseId,
                },
            });
            const chapter = await this.prisma.chapter.findFirst({
                where: {
                    moduleId: module.id,
                },
                include: {
                    sections: true,
                },
            });
            let percentage = 0;
            if (chapter.sections.length > 0) {
                percentage =
                    (userCourseProgress.length / chapter.sections.length) * 100;
            }
            return {
                message: 'User course progress updated successfully',
                statusCode: 200,
                data: {
                    userCourseProgress: percentage,
                    courseProgressData: userCourseProgress,
                },
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
    async getLastSeenSection(userId, chapterId) {
        try {
            const getLastSeenSection = await this.prisma.lastSeenSection.findUnique({
                where: {
                    userId_chapterId: { userId, chapterId },
                },
            });
            return {
                message: 'success',
                statusCode: 200,
                data: getLastSeenSection,
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
    async updateLastSeenSection(userId, chapterId, sectionId, moduleId, courseId) {
        try {
            await this.prisma.lastSeenSection.upsert({
                where: {
                    userId_chapterId: { userId, chapterId },
                },
                update: {
                    sectionId,
                },
                create: {
                    userId,
                    chapterId,
                    sectionId,
                    moduleId,
                    courseId,
                },
            });
            return {
                message: 'success',
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
    async submitCourseFeedback(studentId, courseId, formData) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: {
                    courseId: courseId,
                },
            });
            if (!feedbackForm) {
                throw new Error('No feedback form found for this course');
            }
            const enrollment = await this.prisma.userCourse.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                    isActive: true,
                },
            });
            if (!enrollment) {
                throw new Error('You are not enrolled in this course');
            }
            const existingCompletion = await this.prisma.courseFeedbackSubmission.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                },
            });
            if (existingCompletion) {
                throw new Error('You have already completed the feedback form for this course');
            }
            const completion = await this.prisma.courseFeedbackSubmission.create({
                data: {
                    userId: studentId,
                    courseId: courseId,
                    feedbackFormId: feedbackForm.id,
                    responses: formData,
                },
            });
            return {
                message: 'Course feedback submitted successfully',
                statusCode: 200,
                data: completion,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to submit feedback',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getCourseFeedbackStatus(studentId, courseId) {
        try {
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: {
                    courseId: courseId,
                },
            });
            if (!feedbackForm) {
                throw new Error('No feedback form found for this course');
            }
            const completion = await this.prisma.courseFeedbackSubmission.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                },
            });
            return {
                message: 'Course feedback status fetched successfully',
                statusCode: 200,
                data: {
                    hasFeedbackForm: true,
                    isCompleted: !!completion,
                    feedbackForm: {
                        formName: feedbackForm.formName,
                        isRequired: feedbackForm.isRequired,
                        submittedAt: completion?.submittedAt || null,
                    },
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch feedback status',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getCourseFeedbackSubmissions(courseId, adminId) {
        try {
            const admin = await this.prisma.user.findUnique({
                where: { id: adminId },
            });
            if (!admin || admin.role !== 'admin') {
                throw new Error('Only admins can view feedback submissions');
            }
            const completions = await this.prisma.courseFeedbackSubmission.findMany({
                where: {
                    courseId: courseId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: { submittedAt: 'desc' },
            });
            return {
                message: 'Course feedback submissions fetched successfully',
                statusCode: 200,
                data: {
                    courseId,
                    submissions: completions.map((completion) => ({
                        user: completion.user,
                        submittedAt: completion.submittedAt,
                        responses: completion.responses,
                    })),
                    totalSubmissions: completions.length,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch feedback submissions',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
};
exports.CourseService = CourseService;
exports.CourseService = CourseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseService);
//# sourceMappingURL=course.service.js.map