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
const prisma_service_1 = require("../prisma/prisma.service");
let CourseService = class CourseService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getCourseReport(courseId) {
        try {
            const report = await this.prisma.module.findMany({
                where: {
                    courseId: courseId,
                },
                include: {
                    chapters: {
                        select: {
                            id: true,
                            title: true,
                            quizzes: true,
                            QuizAnswer: true,
                            UserCourseProgress: true,
                            LastSeenSection: true,
                            sections: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully retrieved data',
                statusCode: 200,
                data: report,
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
            console.log({ userId });
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
            const course = await this.prisma.course.create({
                data: {
                    title: body.title,
                    description: body.description,
                    assessment: body.assessment,
                    duration: body.duration,
                    overview: body.overview,
                    image: body.image,
                    syllabusOverview: body.syllabusOverview,
                    resourcesOverview: body.resourcesOverview,
                    assessments: body.assessments,
                    resources: body.resources,
                    syllabus: body.syllabus,
                },
            });
            return {
                message: 'Successfully create course record',
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
            const section = await this.prisma.section.create({
                data: {
                    title: body.title,
                    description: body.description,
                    chapterId: body.id,
                },
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
            const course = await this.prisma.course.findUnique({ where: { id } });
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
                    modules: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });
            if (!(courses.length > 0)) {
                throw new Error('No Courses found');
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
                    chapters: {
                        include: {
                            sections: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
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
    async getAllUserModules(id) {
        try {
            const modules = await this.prisma.module.findMany({
                where: {
                    courseId: id,
                },
                include: {
                    chapters: {
                        orderBy: {
                            createdAt: 'asc',
                        },
                        include: {
                            sections: true,
                        },
                    },
                    course: {
                        select: {
                            UserCourseProgress: true,
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
    async getAllChapters(id) {
        try {
            const chapters = await this.prisma.chapter.findMany({
                where: {
                    moduleId: id,
                },
                include: {
                    sections: true,
                    quizzes: true,
                },
                orderBy: {
                    createdAt: 'desc',
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
                    createdAt: 'desc',
                },
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
        function insertQuizzes(sections, quizzes) {
            const availableIndexes = [];
            if (sections.length > 2) {
                for (let i = 1; i < sections.length - 1; i++) {
                    availableIndexes.push(i);
                }
            }
            const shuffledQuizzes = quizzes.sort(() => Math.random() - 0.5);
            for (let i = 0; i < shuffledQuizzes.length; i++) {
                const randomIndex = availableIndexes.splice(Math.floor(Math.random() * availableIndexes.length), 1)[0];
                sections.splice(randomIndex, 0, shuffledQuizzes[i]);
            }
            return sections;
        }
        try {
            const [sections, userCourseProgress, chapter, quizAnswer, lastSeenLesson,] = await Promise.all([
                this.prisma.section.findMany({
                    where: { chapterId: id },
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
                this.prisma.quizAnswer.findMany({
                    where: { userId, chapterId: id },
                }),
                this.prisma.lastSeenSection.findUnique({
                    where: { userId_chapterId: { userId, chapterId: id } },
                }),
            ]);
            console.log('quizzes', chapter?.quizzes);
            const allSections = sections?.length > 0 ? [...sections] : [];
            const completedSections = userCourseProgress?.length > 0 ? [...userCourseProgress] : [];
            const assignedQuizzesList = chapter?.quizzes?.length > 0 ? [...chapter?.quizzes] : [];
            const quizAnsweredList = quizAnswer?.length > 0 ? [...quizAnswer] : [];
            allSections?.forEach((section) => {
                const isCompleted = completedSections?.some((completedSection) => completedSection.sectionId === section.id);
                section.isLastSeen =
                    lastSeenLesson?.sectionId === section.id ? true : false;
                section.isCompleted = isCompleted;
            });
            assignedQuizzesList?.forEach((quiz) => {
                const isCorrect = quizAnsweredList?.some((completedQuestion) => completedQuestion.quizId === quiz.id);
                quiz.isCorrect = isCorrect;
            });
            const mergedArray = insertQuizzes(allSections, assignedQuizzesList);
            if (!(sections.length > 0)) {
                throw new Error('No Sections found');
            }
            return {
                message: 'Successfully fetch all Sections info against chapter',
                statusCode: 200,
                data: mergedArray,
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
            const isCourseExist = await this.prisma.course.findUnique({
                where: { id: id },
            });
            if (!isCourseExist) {
                throw new Error('Course does not exist');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateCourse = {};
            for (const [key, value] of Object.entries(body)) {
                updateCourse[key] = value;
            }
            const updatedCourse = await this.prisma.course.update({
                where: { id },
                data: updateCourse,
            });
            return {
                message: 'Successfully updated course record',
                statusCode: 200,
                data: updatedCourse,
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
            console.log({ body });
            for (const [key, value] of Object.entries(body)) {
                updateChapter[key] = value;
            }
            console.log({ updateChapter });
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
                throw new Error('Section already exist with specified title');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateSection = {};
            for (const [key, value] of Object.entries(body)) {
                updateSection[key] = value;
            }
            const updatedSection = await this.prisma.section.update({
                where: { id },
                data: updateSection,
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
    async deleteCourse(id) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id },
            });
            console.log({ course });
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
            console.log({ error });
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
            console.log({ error });
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
    async assignCourse(userId, courseId) {
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
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    courses: {
                        connect: { id: courseId },
                    },
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
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    courses: {
                        disconnect: { id: courseId },
                    },
                },
            });
            return {
                message: 'Successfully unassigned course to user',
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
    async getAllAssignedCourses(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                include: { courses: true },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const extendedCourses = user.courses.map((course) => ({
                ...course,
            }));
            for (let i = 0; i < extendedCourses.length; i++) {
                const modules = await this.prisma.module.findMany({
                    where: { courseId: extendedCourses[i].id },
                    include: {
                        chapters: {
                            include: {
                                sections: true,
                            },
                        },
                    },
                });
                const sections = modules.flatMap((module) => module.chapters.flatMap((chapter) => chapter.sections));
                extendedCourses[i].totalSections = sections.length;
                const userCourseProgress = await this.prisma.userCourseProgress.findMany({
                    where: {
                        userId,
                        courseId: extendedCourses[i].id,
                    },
                });
                if (extendedCourses[i].totalSections > 0) {
                    const percentage = (userCourseProgress.length / extendedCourses[i].totalSections) *
                        100;
                    extendedCourses[i].percentage = percentage;
                }
                else {
                    extendedCourses[i].percentage = 0;
                }
            }
            return {
                message: 'Successfully retrieved assigned courses',
                statusCode: 200,
                data: extendedCourses,
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
                },
            });
            if (!userCourseProgress) {
                userCourseProgress = await this.prisma.userCourseProgress.create({
                    data: {
                        userId: userId,
                        courseId: body.courseId,
                        chapterId: body.chapterId,
                        sectionId: body.sectionId,
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
    async updateLastSeenSection(userId, chapterId, sectionId) {
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
};
exports.CourseService = CourseService;
exports.CourseService = CourseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseService);
//# sourceMappingURL=course.service.js.map