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
var CourseAssessmentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseAssessmentService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const notification_service_1 = require("../notifiications/notification.service");
let CourseAssessmentService = CourseAssessmentService_1 = class CourseAssessmentService {
    constructor(prisma, notificationService) {
        this.prisma = prisma;
        this.notificationService = notificationService;
    }
    throwQuestionCategoryError(error, fallback) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'A category with this name already exists for this course.',
                }, common_1.HttpStatus.CONFLICT, { cause: error });
            }
            if (error.code === 'P2025') {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Category not found' }, common_1.HttpStatus.NOT_FOUND, { cause: error });
            }
        }
        if (error instanceof Error && error.message === 'Course not found') {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: error.message }, common_1.HttpStatus.NOT_FOUND, { cause: error });
        }
        if (error instanceof Error &&
            error.message.startsWith('Cannot delete a category that has active questions')) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.BAD_REQUEST, error: error.message }, common_1.HttpStatus.BAD_REQUEST, { cause: error });
        }
        const message = error instanceof Error ? error.message : fallback;
        throw new common_1.HttpException({ status: common_1.HttpStatus.INTERNAL_SERVER_ERROR, error: message || fallback }, common_1.HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
    }
    async createCategory(adminId, body) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: body.courseId },
            });
            if (!course)
                throw new Error('Course not found');
            const category = await this.prisma.questionCategory.create({
                data: { name: body.name, courseId: body.courseId },
            });
            return { message: 'Category created successfully', statusCode: 200, data: category };
        }
        catch (error) {
            this.throwQuestionCategoryError(error, 'Failed to create category');
        }
    }
    async getCategoriesByCourse(courseId) {
        try {
            const categories = await this.prisma.questionCategory.findMany({
                where: { courseId },
                orderBy: { name: 'asc' },
            });
            return { message: 'Categories fetched successfully', statusCode: 200, data: categories };
        }
        catch (error) {
            this.throwQuestionCategoryError(error, 'Failed to fetch categories');
        }
    }
    async updateCategory(categoryId, body) {
        try {
            const category = await this.prisma.questionCategory.update({
                where: { id: categoryId },
                data: { name: body.name },
            });
            return { message: 'Category updated successfully', statusCode: 200, data: category };
        }
        catch (error) {
            this.throwQuestionCategoryError(error, 'Failed to update category');
        }
    }
    async deleteCategory(categoryId) {
        try {
            const activeQuestions = await this.prisma.question.count({
                where: { categoryId, isActive: true },
            });
            if (activeQuestions > 0)
                throw new Error('Cannot delete a category that has active questions. Deactivate the questions first.');
            await this.prisma.questionCategory.delete({ where: { id: categoryId } });
            return { message: 'Category deleted successfully', statusCode: 200, data: {} };
        }
        catch (error) {
            this.throwQuestionCategoryError(error, 'Failed to delete category');
        }
    }
    async createQuestion(adminId, body) {
        try {
            const category = await this.prisma.questionCategory.findUnique({
                where: { id: body.categoryId },
            });
            if (!category)
                throw new Error('Category not found');
            if (category.courseId !== body.courseId)
                throw new Error('Category does not belong to the specified course');
            const question = await this.prisma.question.create({
                data: {
                    courseId: body.courseId,
                    categoryId: body.categoryId,
                    type: body.type,
                    difficulty: body.difficulty,
                    text: body.text,
                    imageUrl: body.imageUrl ?? null,
                    content: body.content,
                    maxMarks: body.maxMarks,
                },
            });
            return { message: 'Question created successfully', statusCode: 200, data: question };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to create question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getQuestions(courseId, filters) {
        try {
            const questions = await this.prisma.question.findMany({
                where: {
                    courseId,
                    ...(filters.categoryId && { categoryId: filters.categoryId }),
                    ...(filters.difficulty && { difficulty: filters.difficulty }),
                    ...(filters.type && { type: filters.type }),
                    ...(filters.isActive !== undefined && { isActive: filters.isActive }),
                },
                include: { category: { select: { id: true, name: true } } },
                orderBy: { createdAt: 'desc' },
            });
            return { message: 'Questions fetched successfully', statusCode: 200, data: questions };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch questions' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getQuestionById(questionId) {
        try {
            const question = await this.prisma.question.findUnique({
                where: { id: questionId },
                include: { category: true },
            });
            if (!question)
                throw new Error('Question not found');
            return { message: 'Question fetched successfully', statusCode: 200, data: question };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async updateQuestion(questionId, body) {
        try {
            const question = await this.prisma.question.update({
                where: { id: questionId },
                data: {
                    ...(body.categoryId && { categoryId: body.categoryId }),
                    ...(body.type && { type: body.type }),
                    ...(body.difficulty && { difficulty: body.difficulty }),
                    ...(body.text && { text: body.text }),
                    ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
                    ...(body.content && { content: body.content }),
                    ...(body.maxMarks !== undefined && { maxMarks: body.maxMarks }),
                    ...(body.isActive !== undefined && { isActive: body.isActive }),
                },
            });
            return { message: 'Question updated successfully', statusCode: 200, data: question };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to update question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async deleteQuestion(questionId, permanent) {
        try {
            const question = await this.prisma.question.findUnique({
                where: { id: questionId },
            });
            if (!question)
                throw new Error('Question not found');
            if (permanent) {
                const usedInAttempt = await this.prisma.attemptQuestionSnapshot.count({
                    where: { questionId },
                });
                if (usedInAttempt > 0)
                    throw new Error('This question has been used in student attempts and cannot be permanently deleted. Deactivate it instead.');
                await this.prisma.assessmentQuestion.deleteMany({ where: { questionId } });
                await this.prisma.question.delete({ where: { id: questionId } });
                return { message: 'Question permanently deleted', statusCode: 200, data: {} };
            }
            else {
                const updated = await this.prisma.question.update({
                    where: { id: questionId },
                    data: { isActive: false },
                });
                await this.prisma.assessmentQuestion.deleteMany({
                    where: { questionId, assessment: { isActive: false } },
                });
                return { message: 'Question deactivated successfully', statusCode: 200, data: updated };
            }
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to delete question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async createAssessment(adminId, body) {
        try {
            const course = await this.prisma.course.findUnique({ where: { id: body.courseId } });
            if (!course)
                throw new Error('Course not found');
            if (body.mode === client_1.AssessmentMode.AUTOMATIC && !body.autoConfig)
                throw new Error('autoConfig is required for AUTOMATIC mode');
            const assessment = await this.prisma.assessment.create({
                data: {
                    courseId: body.courseId,
                    title: body.title,
                    description: body.description ?? null,
                    mode: body.mode,
                    passingPercentage: body.passingPercentage,
                    timeLimitMinutes: body.timeLimitMinutes ?? null,
                    maxAttempts: body.maxAttempts ?? null,
                    autoConfig: body.autoConfig ? body.autoConfig : null,
                    createdByAdminId: adminId,
                },
            });
            return { message: 'Assessment created successfully', statusCode: 200, data: assessment };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to create assessment' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async updateAssessment(assessmentId, body) {
        try {
            const assessment = await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: {
                    ...(body.title && { title: body.title }),
                    ...(body.description !== undefined && { description: body.description }),
                    ...(body.passingPercentage !== undefined && { passingPercentage: body.passingPercentage }),
                    ...(body.timeLimitMinutes !== undefined && { timeLimitMinutes: body.timeLimitMinutes }),
                    ...(body.maxAttempts !== undefined && { maxAttempts: body.maxAttempts }),
                    ...(body.autoConfig !== undefined && { autoConfig: body.autoConfig }),
                },
            });
            return { message: 'Assessment updated successfully', statusCode: 200, data: assessment };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to update assessment' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async activateAssessment(assessmentId) {
        try {
            const assessment = await this.prisma.assessment.findUnique({
                where: { id: assessmentId },
                include: { assessmentQuestions: true },
            });
            if (!assessment)
                throw new Error('Assessment not found');
            if (assessment.mode === client_1.AssessmentMode.MANUAL && assessment.assessmentQuestions.length === 0)
                throw new Error('Cannot activate a MANUAL assessment with no questions. Add questions first.');
            if (assessment.mode === client_1.AssessmentMode.AUTOMATIC && !assessment.autoConfig)
                throw new Error('Cannot activate an AUTOMATIC assessment without autoConfig.');
            const activated = await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: { isActive: true },
            });
            return { message: 'Assessment activated successfully', statusCode: 200, data: activated };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to activate assessment' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async deactivateAssessment(assessmentId) {
        try {
            const assessment = await this.prisma.assessment.update({
                where: { id: assessmentId },
                data: { isActive: false },
            });
            return { message: 'Assessment deactivated successfully', statusCode: 200, data: assessment };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to deactivate assessment' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getAssessmentsByCourse(courseId) {
        try {
            const assessments = await this.prisma.assessment.findMany({
                where: { courseId },
                include: {
                    _count: { select: { assessmentQuestions: true, attempts: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
            return { message: 'Assessments fetched successfully', statusCode: 200, data: assessments };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessments' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getAssessmentById(assessmentId) {
        try {
            const assessment = await this.prisma.assessment.findUnique({
                where: { id: assessmentId },
                include: {
                    assessmentQuestions: {
                        include: { question: true },
                        orderBy: { orderIndex: 'asc' },
                    },
                    _count: { select: { attempts: true } },
                },
            });
            if (!assessment)
                throw new Error('Assessment not found');
            return { message: 'Assessment fetched successfully', statusCode: 200, data: assessment };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessment' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async addQuestionToAssessment(assessmentId, body) {
        try {
            const assessment = await this.prisma.assessment.findUnique({
                where: { id: assessmentId },
            });
            if (!assessment)
                throw new Error('Assessment not found');
            if (assessment.mode !== client_1.AssessmentMode.MANUAL)
                throw new Error('Questions can only be added manually to MANUAL mode assessments');
            const question = await this.prisma.question.findUnique({
                where: { id: body.questionId },
            });
            if (!question)
                throw new Error('Question not found');
            if (question.courseId !== assessment.courseId)
                throw new Error('Question does not belong to the same course as this assessment');
            if (!question.isActive)
                throw new Error('Cannot add an inactive question to an assessment');
            const aq = await this.prisma.assessmentQuestion.create({
                data: {
                    assessmentId,
                    questionId: body.questionId,
                    orderIndex: body.orderIndex ?? 0,
                    marksOverride: body.marksOverride ?? null,
                },
                include: { question: true },
            });
            return { message: 'Question added to assessment', statusCode: 200, data: aq };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to add question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async removeQuestionFromAssessment(assessmentId, questionId) {
        try {
            const hasAttempts = await this.prisma.assessmentAttempt.count({
                where: { assessmentId, status: client_1.AssessmentAttemptStatus.FINALIZED },
            });
            if (hasAttempts > 0)
                throw new Error('Cannot remove questions from an assessment that has finalized attempts');
            await this.prisma.assessmentQuestion.deleteMany({
                where: { assessmentId, questionId },
            });
            return { message: 'Question removed from assessment', statusCode: 200, data: {} };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to remove question' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async reorderAssessmentQuestions(assessmentId, body) {
        try {
            await this.prisma.$transaction(body.questions.map((q) => this.prisma.assessmentQuestion.updateMany({
                where: { assessmentId, questionId: q.questionId },
                data: { orderIndex: q.orderIndex },
            })));
            return { message: 'Questions reordered successfully', statusCode: 200, data: {} };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to reorder questions' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getActiveAssessmentForStudent(userId, courseId) {
        try {
            const enrollment = await this.prisma.userCourse.findFirst({
                where: { userId, courseId, isActive: true },
            });
            if (!enrollment)
                throw new Error('You are not enrolled in this course');
            const assessments = await this.prisma.assessment.findMany({
                where: { courseId, isActive: true },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    mode: true,
                    passingPercentage: true,
                    timeLimitMinutes: true,
                    maxAttempts: true,
                },
                orderBy: { createdAt: 'asc' },
            });
            const isEligible = await this._isCourseContentCompleted(userId, courseId);
            const result = await Promise.all(assessments.map(async (assessment) => {
                await this._expireStaleAttempts(userId, assessment.id);
                const attempts = await this.prisma.assessmentAttempt.findMany({
                    where: { userId, assessmentId: assessment.id },
                    select: {
                        id: true,
                        status: true,
                        startedAt: true,
                        submittedAt: true,
                        finalizedAt: true,
                        marksObtained: true,
                        totalMarks: true,
                        percentage: true,
                        isPassed: true,
                        snapshotTimeLimitMin: true,
                    },
                    orderBy: { startedAt: 'desc' },
                });
                const attemptsWithMeta = attempts.map((a) => {
                    const isExpired = a.status === client_1.AssessmentAttemptStatus.EXPIRED;
                    const timeInfo = a.status === client_1.AssessmentAttemptStatus.IN_PROGRESS
                        ? this._computeTimeInfo({
                            startedAt: a.startedAt,
                            snapshotTimeLimitMin: a.snapshotTimeLimitMin,
                        })
                        : null;
                    return { ...a, isExpired, timeInfo };
                });
                const inProgressAttempt = attemptsWithMeta.find((a) => a.status === client_1.AssessmentAttemptStatus.IN_PROGRESS);
                const remainingAttempts = assessment.maxAttempts === null
                    ? null
                    : Math.max(0, assessment.maxAttempts - attempts.length);
                const canStart = isEligible &&
                    !inProgressAttempt &&
                    (assessment.maxAttempts === null || remainingAttempts > 0);
                return {
                    assessment,
                    isEligible,
                    remainingAttempts,
                    canStart,
                    inProgressAttemptId: inProgressAttempt?.id ?? null,
                    attempts: attemptsWithMeta,
                };
            }));
            return {
                message: 'Assessments fetched successfully',
                statusCode: 200,
                data: result,
            };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessments' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async startAttempt(userId, body) {
        try {
            const { assessmentId } = body;
            const assessment = await this.prisma.assessment.findUnique({
                where: { id: assessmentId },
                include: {
                    assessmentQuestions: {
                        include: { question: true },
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            });
            if (!assessment)
                throw new Error('Assessment not found');
            if (!assessment.isActive)
                throw new Error('This assessment is not currently active');
            const courseId = assessment.courseId;
            const enrollment = await this.prisma.userCourse.findFirst({
                where: { userId, courseId, isActive: true },
            });
            if (!enrollment)
                throw new Error('You are not enrolled in this course');
            const isComplete = await this._isCourseContentCompleted(userId, courseId);
            if (!isComplete)
                throw new Error('You must complete all course content before attempting the assessment');
            const attemptCount = await this.prisma.assessmentAttempt.count({
                where: { userId, assessmentId: assessment.id },
            });
            if (assessment.maxAttempts !== null && attemptCount >= assessment.maxAttempts)
                throw new Error(`Maximum attempts (${assessment.maxAttempts}) reached for this assessment`);
            await this._expireStaleAttempts(userId, assessment.id);
            const inProgress = await this.prisma.assessmentAttempt.findFirst({
                where: { userId, assessmentId: assessment.id, status: client_1.AssessmentAttemptStatus.IN_PROGRESS },
            });
            if (inProgress)
                throw new Error('You already have an in-progress attempt. Complete or submit it first.');
            const selectedQuestions = await this._buildQuestionList(assessment);
            const totalMarks = selectedQuestions.reduce((sum, q) => sum + q.effectiveMarks, 0);
            const attempt = await this.prisma.assessmentAttempt.create({
                data: {
                    assessmentId: assessment.id,
                    userId,
                    snapshotTitle: assessment.title,
                    snapshotPassingPct: assessment.passingPercentage,
                    snapshotMaxAttempts: assessment.maxAttempts,
                    snapshotTimeLimitMin: assessment.timeLimitMinutes,
                    totalMarks,
                    questionSnapshots: {
                        createMany: {
                            data: selectedQuestions.map((q, idx) => ({
                                questionId: q.id,
                                orderIndex: idx,
                                questionType: q.type,
                                questionText: q.text,
                                questionImageUrl: q.imageUrl ?? null,
                                questionContent: q.content,
                                maxMarks: q.effectiveMarks,
                            })),
                        },
                    },
                },
                include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
            });
            const sanitized = this._stripCorrectAnswers(attempt);
            const timeInfo = this._computeTimeInfo({
                startedAt: attempt.startedAt,
                snapshotTimeLimitMin: attempt.snapshotTimeLimitMin,
            });
            return {
                message: 'Attempt started successfully',
                statusCode: 200,
                data: { ...sanitized, timeInfo },
            };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to start attempt' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getAttempt(userId, attemptId) {
        try {
            const attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            if (attempt.userId !== userId)
                throw new Error('You do not have access to this attempt');
            await this._expireStaleAttempts(userId, attempt.assessmentId);
            const fresh = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
            });
            if (!fresh)
                throw new Error('Attempt not found');
            const sanitized = this._stripCorrectAnswers(fresh);
            const timeInfo = this._computeTimeInfo({
                startedAt: fresh.startedAt,
                snapshotTimeLimitMin: fresh.snapshotTimeLimitMin,
            });
            return {
                message: 'Attempt fetched successfully',
                statusCode: 200,
                data: { ...sanitized, timeInfo },
            };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempt' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async submitAttempt(userId, attemptId, body) {
        try {
            let attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: true },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            if (attempt.userId !== userId)
                throw new Error('You do not have access to this attempt');
            await this._expireStaleAttempts(userId, attempt.assessmentId);
            attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: true },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            if (attempt.status !== client_1.AssessmentAttemptStatus.IN_PROGRESS) {
                if (attempt.status === client_1.AssessmentAttemptStatus.EXPIRED) {
                    throw new common_1.HttpException({
                        status: common_1.HttpStatus.BAD_REQUEST,
                        error: 'Time limit exceeded. Your assessment time has expired and this attempt can no longer be submitted.',
                    }, common_1.HttpStatus.BAD_REQUEST);
                }
                throw new Error('This attempt is not in progress');
            }
            const graceMs = CourseAssessmentService_1.ASSESSMENT_TIMER_GRACE_SECONDS * 1000;
            if (attempt.snapshotTimeLimitMin != null) {
                const deadline = new Date(attempt.startedAt.getTime() +
                    attempt.snapshotTimeLimitMin * 60000 +
                    graceMs);
                if (new Date() > deadline) {
                    throw new common_1.HttpException({
                        status: common_1.HttpStatus.BAD_REQUEST,
                        error: 'Time limit exceeded. Your assessment time has expired.',
                    }, common_1.HttpStatus.BAD_REQUEST);
                }
            }
            const answerMap = new Map(body.answers.map((a) => [a.snapshotId, a.studentAnswer]));
            const snapshotUpdates = attempt.questionSnapshots.map((snapshot) => {
                const studentAnswer = answerMap.get(snapshot.id) ?? null;
                const systemScore = studentAnswer !== null
                    ? this._calculateAutoScore(snapshot.questionType, snapshot.questionContent, studentAnswer, snapshot.maxMarks)
                    : null;
                return { snapshot, studentAnswer, systemScore };
            });
            const answeredSnapshots = snapshotUpdates.filter((u) => u.studentAnswer !== null);
            const hasManualQuestions = answeredSnapshots.some((u) => u.snapshot.questionType === client_1.QuestionType.SHORT_ANSWER ||
                u.snapshot.questionType === client_1.QuestionType.LONG_ANSWER);
            let newStatus;
            let marksObtained = null;
            let percentage = null;
            let isPassed = null;
            if (!hasManualQuestions) {
                marksObtained = snapshotUpdates.reduce((sum, u) => sum + (u.systemScore ?? 0), 0);
                percentage =
                    attempt.totalMarks && attempt.totalMarks > 0
                        ? (marksObtained / attempt.totalMarks) * 100
                        : 0;
                isPassed = percentage >= attempt.snapshotPassingPct;
                newStatus = client_1.AssessmentAttemptStatus.AUTO_GRADED;
            }
            else {
                newStatus = client_1.AssessmentAttemptStatus.SUBMITTED;
            }
            const updated = await this.prisma.$transaction(async (tx) => {
                await Promise.all(snapshotUpdates.map((u) => tx.attemptQuestionSnapshot.update({
                    where: { id: u.snapshot.id },
                    data: {
                        studentAnswer: u.studentAnswer,
                        isAnswered: u.studentAnswer !== null,
                        systemScore: u.systemScore,
                    },
                })));
                return tx.assessmentAttempt.update({
                    where: { id: attemptId },
                    data: {
                        status: newStatus,
                        submittedAt: new Date(),
                        ...(marksObtained !== null && { marksObtained }),
                        ...(percentage !== null && { percentage }),
                        ...(isPassed !== null && { isPassed }),
                    },
                });
            });
            if (newStatus === client_1.AssessmentAttemptStatus.AUTO_GRADED && isPassed) {
                const assessmentRecord = await this.prisma.assessment.findUnique({
                    where: { id: updated.assessmentId },
                    select: { courseId: true },
                });
                if (assessmentRecord) {
                    await this._upsertCourseCompletion(userId, assessmentRecord.courseId, attemptId, percentage);
                }
            }
            const assessment = await this.prisma.assessment.findUnique({
                where: { id: attempt.assessmentId },
            });
            if (assessment) {
                await this.notificationService.createAssessmentNotification(assessment.createdByAdminId, client_1.NotificationType.ASSESSMENT_SUBMITTED, `A student has submitted the assessment: ${attempt.snapshotTitle}`, attemptId);
            }
            return { message: 'Assessment submitted successfully', statusCode: 200, data: updated };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to submit attempt' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getStudentAttemptHistory(userId, courseId) {
        try {
            const assessmentIds = (await this.prisma.assessment.findMany({
                where: { courseId },
                select: { id: true },
            })).map((a) => a.id);
            const attempts = await this.prisma.assessmentAttempt.findMany({
                where: { userId, assessmentId: { in: assessmentIds } },
                orderBy: { startedAt: 'desc' },
                include: {
                    questionSnapshots: {
                        select: {
                            id: true,
                            questionType: true,
                            questionText: true,
                            questionImageUrl: true,
                            maxMarks: true,
                            studentAnswer: true,
                            isAnswered: true,
                            isLocked: true,
                            systemScore: true,
                            finalScore: true,
                            adminFeedback: true,
                            orderIndex: true,
                        },
                    },
                },
            });
            return { message: 'Attempt history fetched', statusCode: 200, data: attempts };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch history' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getStudentCompletion(userId, courseId) {
        try {
            const completion = await this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                include: {
                    bestAttempt: {
                        select: {
                            id: true,
                            percentage: true,
                            isPassed: true,
                            finalizedAt: true,
                            submittedAt: true,
                        },
                    },
                },
            });
            return { message: 'Completion fetched', statusCode: 200, data: completion ?? null };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch completion' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getAdminAttempts(courseId, filters) {
        try {
            const assessmentIds = (await this.prisma.assessment.findMany({
                where: { courseId },
                select: { id: true },
            })).map((a) => a.id);
            const attempts = await this.prisma.assessmentAttempt.findMany({
                where: {
                    assessmentId: { in: assessmentIds },
                    ...(filters.status && { status: filters.status }),
                    ...(filters.userId && { userId: filters.userId }),
                },
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                    assessment: { select: { id: true, title: true } },
                },
                orderBy: { submittedAt: 'desc' },
            });
            return { message: 'Attempts fetched', statusCode: 200, data: attempts };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempts' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async getAdminAttemptDetail(attemptId) {
        try {
            const attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                    questionSnapshots: { orderBy: { orderIndex: 'asc' } },
                },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            await this._expireStaleAttempts(attempt.userId, attempt.assessmentId);
            const fresh = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                    questionSnapshots: { orderBy: { orderIndex: 'asc' } },
                },
            });
            if (!fresh)
                throw new Error('Attempt not found');
            return { message: 'Attempt fetched', statusCode: 200, data: fresh };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempt' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async gradeAttempt(attemptId, body) {
        try {
            const attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: true },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            if (attempt.status !== client_1.AssessmentAttemptStatus.SUBMITTED &&
                attempt.status !== client_1.AssessmentAttemptStatus.AUTO_GRADED &&
                attempt.status !== client_1.AssessmentAttemptStatus.GRADED)
                throw new Error('This attempt is not available for grading');
            for (const score of body.scores) {
                const snapshot = attempt.questionSnapshots.find((s) => s.id === score.snapshotId);
                if (!snapshot)
                    throw new Error(`Snapshot ${score.snapshotId} not found in this attempt`);
                if (score.adminScore > snapshot.maxMarks)
                    throw new Error(`Score ${score.adminScore} exceeds max marks ${snapshot.maxMarks} for question ${score.snapshotId}`);
            }
            await this.prisma.$transaction([
                ...body.scores.map((score) => this.prisma.attemptQuestionSnapshot.update({
                    where: { id: score.snapshotId },
                    data: {
                        adminScore: score.adminScore,
                        adminFeedback: score.adminFeedback ?? null,
                        gradedAt: new Date(),
                    },
                })),
                this.prisma.assessmentAttempt.update({
                    where: { id: attemptId },
                    data: { status: client_1.AssessmentAttemptStatus.GRADED },
                }),
            ]);
            const updatedSnapshots = await this.prisma.attemptQuestionSnapshot.findMany({
                where: { attemptId },
            });
            const previewMarks = updatedSnapshots.reduce((sum, s) => sum + (s.adminScore ?? s.systemScore ?? 0), 0);
            const previewPct = attempt.totalMarks && attempt.totalMarks > 0
                ? (previewMarks / attempt.totalMarks) * 100
                : 0;
            const updated = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
            });
            return {
                message: 'Grading saved. Call /finalize to publish the final grade.',
                statusCode: 200,
                data: { attempt: updated, previewMarks, previewPercentage: previewPct },
            };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to grade attempt' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async finalizeGrade(adminId, attemptId) {
        try {
            const attempt = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: true, assessment: true },
            });
            if (!attempt)
                throw new Error('Attempt not found');
            if (attempt.status !== client_1.AssessmentAttemptStatus.GRADED &&
                attempt.status !== client_1.AssessmentAttemptStatus.AUTO_GRADED &&
                attempt.status !== client_1.AssessmentAttemptStatus.SUBMITTED)
                throw new Error('Attempt must be graded before it can be finalized');
            const snapshotUpdates = attempt.questionSnapshots.map((s) => this.prisma.attemptQuestionSnapshot.update({
                where: { id: s.id },
                data: { finalScore: s.adminScore ?? s.systemScore ?? 0 },
            }));
            const marksObtained = attempt.questionSnapshots.reduce((sum, s) => sum + (s.adminScore ?? s.systemScore ?? 0), 0);
            const percentage = attempt.totalMarks && attempt.totalMarks > 0
                ? (marksObtained / attempt.totalMarks) * 100
                : 0;
            const isPassed = percentage >= attempt.snapshotPassingPct;
            await this.prisma.$transaction([
                ...snapshotUpdates,
                this.prisma.assessmentAttempt.update({
                    where: { id: attemptId },
                    data: {
                        status: client_1.AssessmentAttemptStatus.FINALIZED,
                        marksObtained,
                        percentage,
                        isPassed,
                        gradedAt: new Date(),
                        finalizedAt: new Date(),
                    },
                }),
            ]);
            if (attempt.assessment) {
                await this._upsertCourseCompletion(attempt.userId, attempt.assessment.courseId, attemptId, percentage);
            }
            await this.notificationService.createAssessmentNotification(attempt.userId, client_1.NotificationType.ASSESSMENT_GRADED, `Your assessment "${attempt.snapshotTitle}" has been graded. You ${isPassed ? 'passed' : 'did not pass'}.`, attemptId);
            const finalized = await this.prisma.assessmentAttempt.findUnique({
                where: { id: attemptId },
                include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
            });
            return { message: 'Assessment finalized successfully', statusCode: 200, data: finalized };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to finalize grade' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async setCertificate(userId, courseId, body) {
        try {
            const completion = await this.prisma.courseCompletion.update({
                where: { userId_courseId: { userId, courseId } },
                data: { certificateUrl: body.certificateUrl },
            });
            return { message: 'Certificate URL saved', statusCode: 200, data: completion };
        }
        catch (error) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.FORBIDDEN, error: error?.message || 'Failed to set certificate' }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async _isCourseContentCompleted(userId, courseId) {
        const totalSections = await this.prisma.section.count({
            where: { chapter: { module: { courseId } } },
        });
        if (totalSections === 0)
            return true;
        const completedSections = await this.prisma.userCourseProgress.count({
            where: { userId, courseId },
        });
        return completedSections >= totalSections;
    }
    async _buildQuestionList(assessment) {
        if (assessment.mode === client_1.AssessmentMode.MANUAL) {
            return assessment.assessmentQuestions.map((aq) => ({
                id: aq.question.id,
                type: aq.question.type,
                text: aq.question.text,
                imageUrl: aq.question.imageUrl,
                content: aq.question.content,
                effectiveMarks: aq.marksOverride ?? aq.question.maxMarks,
            }));
        }
        const config = assessment.autoConfig;
        const selected = [];
        for (const categoryRule of config.byCategory) {
            const pool = await this.prisma.question.findMany({
                where: {
                    courseId: assessment.courseId,
                    categoryId: categoryRule.categoryId,
                    isActive: true,
                },
            });
            if (pool.length < categoryRule.count)
                throw new Error(`Not enough active questions in category ${categoryRule.categoryId}. Need ${categoryRule.count}, have ${pool.length}.`);
            const shuffled = this._shuffle(pool);
            selected.push(...shuffled.slice(0, categoryRule.count));
        }
        return this._shuffle(selected).slice(0, config.totalQuestions).map((q) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl,
            content: q.content,
            effectiveMarks: q.maxMarks,
        }));
    }
    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    _calculateAutoScore(type, content, answer, maxMarks) {
        if (!answer)
            return null;
        switch (type) {
            case client_1.QuestionType.SINGLE_CHOICE:
                return answer.selectedOptionId === content.correctOptionId ? maxMarks : 0;
            case client_1.QuestionType.TRUE_FALSE:
                return answer.answer === content.correctAnswer ? maxMarks : 0;
            case client_1.QuestionType.FILL_IN_THE_BLANK:
                return (answer.selectedWord ?? '').toLowerCase().trim() ===
                    (content.correctAnswer ?? '').toLowerCase().trim()
                    ? maxMarks
                    : 0;
            case client_1.QuestionType.MULTIPLE_CHOICE: {
                const correct = new Set(content.correctOptionIds ?? []);
                const selected = new Set(answer.selectedOptionIds ?? []);
                const intersection = [...correct].filter((x) => selected.has(x)).length;
                const union = new Set([...correct, ...selected]).size;
                return union === 0 ? 0 : (intersection / union) * maxMarks;
            }
            case client_1.QuestionType.VISUAL_ACTIVITY: {
                const correct = new Set(content.options?.filter((o) => o.isCorrect).map((o) => o.id) ?? []);
                const selected = new Set(answer.selectedOptionIds ?? []);
                if (correct.size === 1 && !content.allowMultiple) {
                    const [onlyCorrect] = correct;
                    return selected.has(onlyCorrect) && selected.size === 1 ? maxMarks : 0;
                }
                const intersection = [...correct].filter((x) => selected.has(x)).length;
                const union = new Set([...correct, ...selected]).size;
                return union === 0 ? 0 : (intersection / union) * maxMarks;
            }
            case client_1.QuestionType.ORDERING: {
                const correct = content.correctOrder ?? [];
                const given = answer.orderedIds ?? [];
                const matches = correct.filter((id, idx) => given[idx] === id).length;
                return correct.length === 0 ? 0 : (matches / correct.length) * maxMarks;
            }
            case client_1.QuestionType.MATCHING: {
                const pairs = content.pairs ?? [];
                const givenPairs = answer.pairs ?? [];
                const correct = givenPairs.filter((gp) => gp.leftId === gp.rightId).length;
                return pairs.length === 0 ? 0 : (correct / pairs.length) * maxMarks;
            }
            case client_1.QuestionType.SHORT_ANSWER:
            case client_1.QuestionType.LONG_ANSWER:
                return null;
            default:
                return null;
        }
    }
    async _expireStaleAttempts(userId, assessmentId) {
        const graceMs = CourseAssessmentService_1.ASSESSMENT_TIMER_GRACE_SECONDS * 1000;
        const stale = await this.prisma.assessmentAttempt.findMany({
            where: {
                userId,
                assessmentId,
                status: client_1.AssessmentAttemptStatus.IN_PROGRESS,
                snapshotTimeLimitMin: { not: null },
            },
        });
        const now = Date.now();
        const expiredIds = stale
            .filter((a) => {
            const deadline = a.startedAt.getTime() + a.snapshotTimeLimitMin * 60000 + graceMs;
            return now > deadline;
        })
            .map((a) => a.id);
        if (expiredIds.length > 0) {
            await this.prisma.assessmentAttempt.updateMany({
                where: { id: { in: expiredIds } },
                data: { status: client_1.AssessmentAttemptStatus.EXPIRED },
            });
        }
    }
    _computeTimeInfo(attempt) {
        if (attempt.snapshotTimeLimitMin == null)
            return null;
        const timeLimitSeconds = attempt.snapshotTimeLimitMin * 60;
        const startedAtMs = attempt.startedAt.getTime();
        const deadlineMs = startedAtMs + attempt.snapshotTimeLimitMin * 60000;
        const remainingSeconds = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
        return {
            timeLimitSeconds,
            startedAtMs,
            deadlineMs,
            remainingSeconds,
            graceSeconds: CourseAssessmentService_1.ASSESSMENT_TIMER_GRACE_SECONDS,
        };
    }
    _stripCorrectAnswers(attempt) {
        if (!attempt)
            return attempt;
        return {
            ...attempt,
            questionSnapshots: (attempt.questionSnapshots ?? []).map((s) => {
                const { questionContent, ...rest } = s;
                const sanitizedContent = { ...questionContent };
                delete sanitizedContent.correctOptionId;
                delete sanitizedContent.correctOptionIds;
                delete sanitizedContent.correctAnswer;
                delete sanitizedContent.correctOrder;
                if (sanitizedContent.pairs) {
                    const categories = this._shuffle(sanitizedContent.pairs.map((p) => ({ id: p.id, text: p.right })));
                    sanitizedContent.categories = categories;
                    sanitizedContent.pairs = sanitizedContent.pairs.map((p) => ({
                        id: p.id,
                        left: p.left,
                    }));
                }
                if (sanitizedContent.options) {
                    sanitizedContent.options = sanitizedContent.options.map((o) => ({
                        id: o.id,
                        text: o.text,
                    }));
                }
                return { ...rest, questionContent: sanitizedContent };
            }),
        };
    }
    async _upsertCourseCompletion(userId, courseId, attemptId, percentage) {
        const existing = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            include: {
                bestAttempt: { select: { percentage: true } },
            },
        });
        const isBetter = !existing?.bestAttempt || percentage > (existing.bestAttempt.percentage ?? 0);
        await this.prisma.courseCompletion.upsert({
            where: { userId_courseId: { userId, courseId } },
            create: {
                userId,
                courseId,
                isPassed: true,
                bestAttemptId: attemptId,
                assessmentPassedAt: new Date(),
            },
            update: {
                isPassed: true,
                assessmentPassedAt: existing?.assessmentPassedAt ?? new Date(),
                ...(isBetter && { bestAttemptId: attemptId }),
            },
        });
    }
};
exports.CourseAssessmentService = CourseAssessmentService;
CourseAssessmentService.ASSESSMENT_TIMER_GRACE_SECONDS = 60;
exports.CourseAssessmentService = CourseAssessmentService = CourseAssessmentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notification_service_1.NotificationService])
], CourseAssessmentService);
//# sourceMappingURL=course-assessment.service.js.map