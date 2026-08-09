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
var CourseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const dto_1 = require("../dto");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const chapter_progression_1 = require("../utils/chapter-progression");
const course_report_1 = require("../utils/course-report");
const reject_inline_base64_1 = require("../utils/reject-inline-base64");
const promote_form_photo_to_user_1 = require("../utils/promote-form-photo-to-user");
const promote_form_address_to_user_1 = require("../utils/promote-form-address-to-user");
const mail_service_1 = require("../mail/mail.service");
const feedback_service_1 = require("../feedback/feedback.service");
const course_version_service_1 = require("../course-version/course-version.service");
const course_version_manifest_1 = require("../course-version/course-version.manifest");
const course_completion_service_1 = require("../course-completion/course-completion.service");
const learner_percentage_1 = require("../course-version/learner-percentage");
let CourseService = CourseService_1 = class CourseService {
    constructor(prisma, config, mail, feedbackService, courseVersionService, courseCompletion) {
        this.prisma = prisma;
        this.config = config;
        this.mail = mail;
        this.feedbackService = feedbackService;
        this.courseVersionService = courseVersionService;
        this.courseCompletion = courseCompletion;
    }
    async isCourseFrozen(userId, courseId) {
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { courseCompletedAt: true },
        });
        return !!completion?.courseCompletedAt;
    }
    shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    async autoPublishAfterStructureChange(courseId, adminId, changeNotes) {
        try {
            const published = await this.courseVersionService.autoPublishAfterStructuralChange(courseId, adminId, changeNotes);
            if (published) {
                CourseService_1.completionLogger.log(`Auto-published v${published.versionNumber} for course ${courseId}`);
            }
            return published;
        }
        catch (error) {
            CourseService_1.completionLogger.error(`Auto-publish failed for course ${courseId}: ${error?.message ?? error}`);
            return null;
        }
    }
    async resolveCourseIdFromModuleId(moduleId) {
        const mod = await this.prisma.module.findUnique({
            where: { id: moduleId },
            select: { courseId: true },
        });
        if (!mod) {
            throw new Error('Module not found');
        }
        return mod.courseId;
    }
    async resolveCourseIdFromChapterId(chapterId) {
        const chapter = await this.prisma.chapter.findUnique({
            where: { id: chapterId },
            include: { module: { select: { courseId: true } } },
        });
        if (!chapter) {
            throw new Error('Chapter not found');
        }
        return chapter.module.courseId;
    }
    async probeUserCourseResidualState(userId, courseId) {
        const [chapters, assessments] = await Promise.all([
            this.prisma.chapter.findMany({
                where: { module: { courseId } },
                select: { id: true },
            }),
            this.prisma.assessment.findMany({
                where: { courseId },
                select: { id: true },
            }),
        ]);
        const chapterIds = chapters.map((c) => c.id);
        const assessmentIds = assessments.map((a) => a.id);
        const [progressRows, chapterCompletions, moduleCompletions, courseCompletion, timeSpentRows, lastSeenRows, quizProgressRows, quizAnswerRows, formCompletionRows, policyCompletionRows, policyItemCompletionRows, feedbackSubmissionRows, assessmentAttemptRows,] = await Promise.all([
            this.prisma.userCourseProgress.count({ where: { userId, courseId } }),
            this.prisma.userChapterCompletion.count({ where: { userId, courseId } }),
            this.prisma.userModuleCompletion.count({ where: { userId, courseId } }),
            this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true, isPassed: true, courseCompletedAt: true },
            }),
            this.prisma.sectionTimeSpent.count({ where: { userId, courseId } }),
            this.prisma.lastSeenSection.count({ where: { userId, courseId } }),
            chapterIds.length > 0
                ? this.prisma.quizProgress.count({
                    where: { userId, chapterId: { in: chapterIds } },
                })
                : Promise.resolve(0),
            chapterIds.length > 0
                ? this.prisma.quizAnswer.count({
                    where: { userId, chapterId: { in: chapterIds } },
                })
                : Promise.resolve(0),
            this.prisma.userFormCompletion.count({ where: { userId, courseId } }),
            this.prisma.userPolicyCompletion.count({ where: { userId, courseId } }),
            this.prisma.userPolicyItemCompletion.count({
                where: { userId, item: { policy: { courseId } } },
            }),
            this.prisma.courseFeedbackSubmission.count({
                where: { userId, courseId },
            }),
            assessmentIds.length > 0
                ? this.prisma.assessmentAttempt.count({
                    where: { userId, assessmentId: { in: assessmentIds } },
                })
                : Promise.resolve(0),
        ]);
        const counts = {
            progressRows,
            chapterCompletions,
            moduleCompletions,
            courseCompleted: !!courseCompletion?.courseCompletedAt,
            certified: !!courseCompletion?.isPassed,
            timeSpentRows,
            lastSeenRows,
            quizProgressRows,
            quizAnswerRows,
            formCompletionRows,
            policyCompletionRows,
            policyItemCompletionRows,
            feedbackSubmissionRows,
            assessmentAttemptRows,
        };
        const hasAny = progressRows > 0 ||
            chapterCompletions > 0 ||
            moduleCompletions > 0 ||
            !!courseCompletion ||
            timeSpentRows > 0 ||
            lastSeenRows > 0 ||
            quizProgressRows > 0 ||
            quizAnswerRows > 0 ||
            formCompletionRows > 0 ||
            policyCompletionRows > 0 ||
            policyItemCompletionRows > 0 ||
            feedbackSubmissionRows > 0 ||
            assessmentAttemptRows > 0;
        return { hasAny, counts, chapterIds, assessmentIds };
    }
    async wipeUserCourseState(tx, userId, courseId, options) {
        let chapterIds = options.chapterIds;
        let assessmentIds = options.assessmentIds;
        if (!chapterIds || !assessmentIds) {
            const [chapters, assessments] = await Promise.all([
                tx.chapter.findMany({
                    where: { module: { courseId } },
                    select: { id: true },
                }),
                tx.assessment.findMany({
                    where: { courseId },
                    select: { id: true },
                }),
            ]);
            chapterIds = chapters.map((c) => c.id);
            assessmentIds = assessments.map((a) => a.id);
        }
        const sectionProgress = await tx.userCourseProgress.deleteMany({
            where: { userId, courseId },
        });
        const lastSeen = await tx.lastSeenSection.deleteMany({
            where: { userId, courseId },
        });
        const quizProgress = chapterIds.length > 0
            ? await tx.quizProgress.deleteMany({
                where: { userId, chapterId: { in: chapterIds } },
            })
            : { count: 0 };
        const quizAnswers = chapterIds.length > 0
            ? await tx.quizAnswer.deleteMany({
                where: { userId, chapterId: { in: chapterIds } },
            })
            : { count: 0 };
        const formCompletions = await tx.userFormCompletion.deleteMany({
            where: { userId, courseId },
        });
        const policyCompletions = await tx.userPolicyCompletion.deleteMany({
            where: { userId, courseId },
        });
        const policyItemCompletions = await tx.userPolicyItemCompletion.deleteMany({
            where: { userId, item: { policy: { courseId } } },
        });
        const feedbackSubmissions = await tx.courseFeedbackSubmission.deleteMany({
            where: { userId, courseId },
        });
        const courseCompletions = await tx.courseCompletion.deleteMany({
            where: { userId, courseId },
        });
        const chapterCompletions = await tx.userChapterCompletion.deleteMany({
            where: { userId, courseId },
        });
        const moduleCompletions = await tx.userModuleCompletion.deleteMany({
            where: { userId, courseId },
        });
        let sectionTimeSpentCount = 0;
        if (options.deleteSectionTimeSpent) {
            const res = await tx.sectionTimeSpent.deleteMany({
                where: { userId, courseId },
            });
            sectionTimeSpentCount = res.count;
        }
        else {
            const res = await tx.sectionTimeSpent.updateMany({
                where: { userId, courseId },
                data: {
                    totalAttempts: 0,
                    firstAttemptAt: null,
                    lastAttemptAt: null,
                },
            });
            sectionTimeSpentCount = res.count;
        }
        const assessmentAttempts = assessmentIds.length > 0
            ? await tx.assessmentAttempt.deleteMany({
                where: { userId, assessmentId: { in: assessmentIds } },
            })
            : { count: 0 };
        return {
            sectionProgress: sectionProgress.count,
            lastSeen: lastSeen.count,
            quizProgress: quizProgress.count,
            quizAnswers: quizAnswers.count,
            formCompletions: formCompletions.count,
            policyCompletions: policyCompletions.count,
            policyItemCompletions: policyItemCompletions.count,
            feedbackSubmissions: feedbackSubmissions.count,
            courseCompletions: courseCompletions.count,
            chapterCompletions: chapterCompletions.count,
            moduleCompletions: moduleCompletions.count,
            sectionTimeSpent: sectionTimeSpentCount,
            assessmentAttempts: assessmentAttempts.count,
        };
    }
    buildArchiveMessage(entity, stillServedTo, versions) {
        return this.courseVersionService.buildArchiveMessage(entity, stillServedTo, versions);
    }
    async writeArchiveAudit(params) {
        if (!params.adminId)
            return;
        await this.courseVersionService.writeAudit({
            adminId: params.adminId,
            action: `ARCHIVE_${params.entity.toUpperCase()}`,
            targetType: params.entity,
            targetId: params.targetId,
            courseId: params.courseId,
            metadata: {
                title: params.title ?? null,
                stillServedTo: params.stillServedTo,
                versions: params.versions.map((v) => ({
                    versionNumber: v.versionNumber,
                    status: v.status,
                    enrollmentCount: v.enrollmentCount,
                })),
            },
        });
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
    async markFormComplete(userId, userRole, courseId, formId, metadata, courseFormId) {
        const courseForm = await this.prisma.courseForm.findUnique({
            where: { id: courseFormId },
        });
        if (!courseForm) {
            throw new common_1.BadRequestException({
                detail: 'Invalid courseFormId: that course form assignment was not found',
            });
        }
        if (courseForm.courseId !== courseId || courseForm.formId !== formId) {
            throw new common_1.BadRequestException({
                detail: 'courseFormId does not match the given courseId and formId',
            });
        }
        await this._assertEnrollmentUsable(userId, courseId, userRole);
        const existing = await this.prisma.userFormCompletion.findUnique({
            where: {
                userId_courseId_formId: { userId, courseId, formId },
            },
        });
        if (existing?.isComplete) {
            return {
                alreadyCompleted: true,
                id: existing.id,
                courseFormId: existing.courseFormId,
                formId: existing.formId,
                completedAt: existing.completedAt,
                metadata: existing.metadata,
            };
        }
        const completion = await this.prisma.userFormCompletion.upsert({
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
                metadata: (metadata ?? {}),
            },
            update: {
                isComplete: true,
                completedAt: new Date(),
                metadata: (metadata ?? {}),
                courseFormId,
            },
        });
        try {
            await (0, promote_form_photo_to_user_1.promoteFormPhotoToUserIfMissing)(this.prisma, userId, metadata);
        }
        catch (photoErr) {
            const msg = photoErr instanceof Error ? photoErr.message : String(photoErr);
            CourseService_1.completionLogger.warn(`Form photo promotion failed for user ${userId}: ${msg}`);
        }
        try {
            await (0, promote_form_address_to_user_1.promoteFormAddressToUserIfMissing)(this.prisma, userId, metadata);
        }
        catch (addressErr) {
            const msg = addressErr instanceof Error ? addressErr.message : String(addressErr);
            CourseService_1.completionLogger.warn(`Form address promotion failed for user ${userId}: ${msg}`);
        }
        return completion;
    }
    async getStudentCourseFormsStatus(userId, userRole, courseId) {
        await this._assertEnrollmentUsable(userId, courseId, userRole);
        const forms = await this.prisma.courseForm.findMany({
            where: { courseId },
            orderBy: { createdAt: 'asc' },
            include: {
                userFormCompletions: {
                    where: { userId },
                    take: 1,
                },
            },
        });
        return {
            courseId,
            forms: forms.map((f) => {
                const c = f.userFormCompletions[0];
                return {
                    courseFormId: f.id,
                    formId: f.formId,
                    formName: f.formName,
                    isRequired: f.isRequired,
                    isComplete: c?.isComplete ?? false,
                    completedAt: c?.completedAt ?? null,
                };
            }),
        };
    }
    async getCourseFormsWithMetadataForUser(userId, courseId) {
        const forms = await this.prisma.courseForm.findMany({
            where: { courseId },
            orderBy: { createdAt: 'asc' },
            include: {
                userFormCompletions: {
                    where: { userId },
                    take: 1,
                    select: {
                        isComplete: true,
                        completedAt: true,
                        metadata: true,
                    },
                },
            },
        });
        return forms.map((f) => {
            const c = f.userFormCompletions[0];
            return {
                courseFormId: f.id,
                formId: f.formId,
                formName: f.formName,
                isRequired: f.isRequired,
                isComplete: c?.isComplete ?? false,
                completedAt: c?.completedAt ?? null,
                metadata: c?.metadata ?? null,
            };
        });
    }
    async getCourseFeedbackForUserReport(userId, courseId) {
        const [form, submission] = await Promise.all([
            this.prisma.courseFeedbackForm.findUnique({
                where: { courseId },
                select: { formName: true, isRequired: true, isActive: true },
            }),
            this.prisma.courseFeedbackSubmission.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: {
                    submittedAt: true,
                    formVersion: true,
                    meanRating: true,
                    overallRating: true,
                    learnerEmail: true,
                    responses: true,
                },
            }),
        ]);
        if (!form)
            return null;
        return {
            formName: form.formName,
            isRequired: form.isRequired,
            isActive: form.isActive,
            isSubmitted: !!submission,
            submittedAt: submission?.submittedAt ?? null,
            formVersion: submission?.formVersion ?? null,
            meanRating: submission?.meanRating != null ? Number(submission.meanRating) : null,
            overallRating: submission?.overallRating ?? null,
            learnerEmail: submission?.learnerEmail ?? null,
            responses: submission?.responses ?? null,
        };
    }
    async fetchReportActivityData(userId, courseId, chapterIds) {
        const [progressRows, quizAnswerRows, lastSeenRows, quizProgressRows, timeSpentRows,] = await Promise.all([
            this.prisma.userCourseProgress.findMany({
                where: { userId, courseId },
                select: { sectionId: true, chapterId: true, createdAt: true },
            }),
            chapterIds.length === 0
                ? Promise.resolve([])
                : this.prisma.quizAnswer.findMany({
                    where: {
                        userId,
                        isAnswerCorrect: true,
                        chapterId: { in: chapterIds },
                    },
                    select: { chapterId: true },
                }),
            chapterIds.length === 0
                ? Promise.resolve([])
                : this.prisma.lastSeenSection.findMany({
                    where: { userId, chapterId: { in: chapterIds } },
                    select: {
                        chapterId: true,
                        sectionId: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                }),
            chapterIds.length === 0
                ? Promise.resolve([])
                : this.prisma.quizProgress.findMany({
                    where: { userId, chapterId: { in: chapterIds } },
                }),
            this.prisma.sectionTimeSpent.findMany({
                where: { userId, courseId },
                select: { sectionId: true, totalSeconds: true, totalAttempts: true },
            }),
        ]);
        return (0, course_report_1.buildChapterActivityMaps)({
            progressRows,
            quizAnswerRows,
            lastSeenRows,
            quizProgressRows,
            timeSpentRows,
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
            const [userDetails, completion, curriculum, courseForms, courseFeedback, chapterCompletions, moduleCompletions, newSinceCompletion, firstProgress,] = await Promise.all([
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                        address: true,
                        photo: true,
                        role: true,
                        status: true,
                        timezone: true,
                        createdAt: true,
                    },
                }),
                this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId } },
                    select: { courseCompletedAt: true },
                }),
                this.courseVersionService.resolveCurriculumTreeForReport(userId, courseId),
                this.getCourseFormsWithMetadataForUser(userId, courseId),
                this.getCourseFeedbackForUserReport(userId, courseId),
                this.prisma.userChapterCompletion.findMany({
                    where: { userId, courseId },
                    select: { chapterId: true, completedAt: true },
                }),
                this.prisma.userModuleCompletion.findMany({
                    where: { userId, courseId },
                    select: { moduleId: true, completedAt: true },
                }),
                this.courseVersionService.summarizeNewSincePinnedVersion(userId, courseId),
                this.prisma.userCourseProgress.findFirst({
                    where: { userId, courseId },
                    orderBy: { createdAt: 'asc' },
                    select: { createdAt: true },
                }),
            ]);
            const isFrozen = !!completion?.courseCompletedAt;
            const courseStartDate = firstProgress?.createdAt ?? null;
            const chapterCompletedAtById = new Map(chapterCompletions.map((row) => [row.chapterId, row.completedAt]));
            const moduleCompletedAtById = new Map(moduleCompletions.map((row) => [row.moduleId, row.completedAt]));
            const reportMeta = {
                message: 'Successfully retrieved datas',
                statusCode: 200,
                user: userDetails,
                courseForms,
                courseFeedback,
                isCompleted: isFrozen,
                completedAt: completion?.courseCompletedAt ?? null,
                courseStartDate,
                ...(newSinceCompletion ? { newSinceCompletion } : {}),
            };
            if (curriculum.mode === 'versioned') {
                const { tree } = curriculum;
                const liveChapterIds = tree.modules.flatMap((m) => m.chapters.map((c) => c.sourceChapterId));
                const activity = await this.fetchReportActivityData(userId, courseId, liveChapterIds);
                const totalSectionsInCourse = tree.modules.reduce((sum, mod) => {
                    return (sum +
                        mod.chapters.reduce((chSum, chapter) => chSum + chapter.sections.length, 0));
                }, 0);
                const modules = tree.modules.map((mod) => {
                    const moduleId = mod.sourceModuleId;
                    const chapters = mod.chapters.map((chapter) => {
                        const sourceChapterId = chapter.sourceChapterId;
                        const sectionMetas = chapter.sections
                            .sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                            (b.orderIndex ?? Number.MAX_SAFE_INTEGER))
                            .map((s) => ({
                            id: s.id,
                            title: s.title,
                            orderIndex: s.orderIndex,
                            type: s.type,
                        }));
                        return (0, course_report_1.buildChapterReportRow)({
                            id: sourceChapterId,
                            title: chapter.title,
                            sectionMetas,
                            quizzesTotal: chapter.quizzesTotal,
                            activity,
                            chapterCompletedAt: chapterCompletedAtById.get(sourceChapterId) ?? null,
                            isFrozen,
                        });
                    });
                    return (0, course_report_1.applyModuleRollup)({
                        id: moduleId,
                        title: mod.title,
                        completedAt: moduleCompletedAtById.get(moduleId) ?? null,
                        chapters,
                    }, totalSectionsInCourse, isFrozen);
                });
                return {
                    ...reportMeta,
                    data: modules,
                    enrolledVersionNumber: curriculum.versionNumber,
                };
            }
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
                select: {
                    id: true,
                    title: true,
                    modules: {
                        where: { isArchived: false },
                        select: {
                            id: true,
                            title: true,
                            chapters: {
                                where: { isArchived: false },
                                select: {
                                    id: true,
                                    title: true,
                                    sections: {
                                        where: { isArchived: false, isActive: true },
                                        select: {
                                            id: true,
                                            title: true,
                                            orderIndex: true,
                                            type: true,
                                        },
                                        orderBy: { orderIndex: 'asc' },
                                    },
                                    _count: {
                                        select: {
                                            quizzes: { where: { isArchived: false } },
                                        },
                                    },
                                },
                                orderBy: { createdAt: 'asc' },
                            },
                        },
                        orderBy: { createdAt: 'asc' },
                    },
                },
            });
            const liveChapterIds = course.modules.flatMap((m) => m.chapters.map((c) => c.id));
            const activity = await this.fetchReportActivityData(userId, courseId, liveChapterIds);
            const totalSectionsInCourse = course.modules.reduce((sum, mod) => sum +
                mod.chapters.reduce((chSum, ch) => chSum + ch.sections.length, 0), 0);
            const modules = course.modules.map((mod) => {
                const chapters = mod.chapters.map((chapter) => {
                    const sectionMetas = chapter.sections.map((s) => ({
                        id: s.id,
                        title: s.title,
                        orderIndex: s.orderIndex,
                        type: s.type,
                    }));
                    return (0, course_report_1.buildChapterReportRow)({
                        id: chapter.id,
                        title: chapter.title,
                        sectionMetas,
                        quizzesTotal: chapter._count.quizzes,
                        activity,
                        chapterCompletedAt: chapterCompletedAtById.get(chapter.id) ?? null,
                        isFrozen,
                    });
                });
                return (0, course_report_1.applyModuleRollup)({
                    id: mod.id,
                    title: mod.title,
                    completedAt: moduleCompletedAtById.get(mod.id) ?? null,
                    chapters,
                }, totalSectionsInCourse, isFrozen);
            });
            return {
                ...reportMeta,
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
    async getCourseDates(courseId, userId) {
        try {
            const allProgressItem = await this.prisma.userCourseProgress.findMany({
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
            console.log('test');
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
                        ...(body.validityDays != null
                            ? { validityDays: body.validityDays }
                            : {}),
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
    async createModule(body, adminId) {
        try {
            const module = await this.prisma.module.create({
                data: {
                    title: body.title,
                    description: body.description,
                    courseId: body.id,
                },
            });
            const publishedVersion = await this.autoPublishAfterStructureChange(body.id, adminId, `Added module "${body.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully created module (published v${publishedVersion.versionNumber})`
                    : 'Successfully create module record',
                statusCode: 200,
                data: module,
                publishedVersion: publishedVersion ?? undefined,
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
    async createChapter(body, adminId) {
        try {
            const courseId = await this.resolveCourseIdFromModuleId(body.id);
            const chapter = await this.prisma.chapter.create({
                data: {
                    title: body.title,
                    description: body.description,
                    pdfFile: body.pdfFile,
                    moduleId: body.id,
                },
            });
            const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Added chapter "${body.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully created chapter (published v${publishedVersion.versionNumber})`
                    : 'Successfully create chapter record',
                statusCode: 200,
                data: chapter,
                publishedVersion: publishedVersion ?? undefined,
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
    async createSection(body, adminId) {
        try {
            (0, reject_inline_base64_1.assertNoInlineBase64)(body.description);
            (0, reject_inline_base64_1.assertNoInlineBase64)(body.shortDescription, 'shortDescription');
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
            const chapterId = section.chapterId;
            const courseId = await this.resolveCourseIdFromChapterId(chapterId);
            const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Added section "${section.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully created section (published v${publishedVersion.versionNumber})`
                    : 'Successfully create section record',
                statusCode: 200,
                data: section,
                publishedVersion: publishedVersion ?? undefined,
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
            const completion = await this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { courseCompletedAt: true },
            });
            if (completion?.courseCompletedAt) {
                const expiresAt = new Date(completion.courseCompletedAt);
                expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
                if (new Date() > expiresAt) {
                    return {
                        message: `Your access to this course expired on ${expiresAt.toISOString().split('T')[0]}. Please contact your administrator to renew access.`,
                        statusCode: 403,
                        data: { canAccessContent: false, expired: true, expiresAt },
                    };
                }
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
            const course = await this.prisma.course.findFirst({
                where: { id, isActive: true },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    image: true,
                    price: true,
                    modules: {
                        where: { isArchived: false },
                        select: {
                            id: true,
                            title: true,
                            chapters: {
                                where: { isArchived: false },
                                orderBy: {
                                    createdAt: 'asc',
                                },
                            },
                            _count: {
                                select: {
                                    chapters: { where: { isArchived: false } },
                                    sections: { where: { isArchived: false, isActive: true } },
                                },
                            },
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
                            modules: { where: { isArchived: false } },
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
            const data = courses.map((course) => ({
                ...course,
                status: course.isActive ? 'active' : 'inactive',
            }));
            return {
                message: 'Successfully fetched all Courses with form information',
                statusCode: 200,
                data,
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
                where: { isActive: true },
                include: {
                    _count: {
                        select: {
                            modules: { where: { isArchived: false } },
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
    async setCourseActive(courseId, isActive) {
        try {
            const existing = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!existing) {
                throw new Error('Course not found');
            }
            const course = await this.prisma.course.update({
                where: { id: courseId },
                data: { isActive },
            });
            return {
                message: isActive
                    ? 'Course activated successfully'
                    : 'Course deactivated successfully',
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
    async getAllModules(id) {
        try {
            const modules = await this.prisma.module.findMany({
                where: {
                    courseId: id,
                    isArchived: false,
                },
                include: {
                    _count: {
                        select: {
                            chapters: { where: { isArchived: false } },
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
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
            const [completion, curriculum, quizProgressRows] = await Promise.all([
                this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId: id } },
                    select: { courseCompletedAt: true },
                }),
                this.courseVersionService.resolveCurriculumTree(userId, id),
                this.prisma.quizProgress.findMany({ where: { userId } }),
            ]);
            const isFrozen = !!completion?.courseCompletedAt;
            const newSinceCompletion = await this.courseVersionService.summarizeNewSincePinnedVersion(userId, id);
            if (curriculum.mode === 'versioned') {
                const progressRows = await this.prisma.userCourseProgress.findMany({
                    where: { userId, courseId: id },
                    select: { sectionId: true, chapterId: true, moduleId: true },
                });
                const progressByChapter = new Map();
                const progressByModule = new Map();
                const progressSectionIds = new Set(progressRows.map((p) => p.sectionId));
                for (const mod of curriculum.tree.modules) {
                    const sourceModuleId = mod.sourceModuleId;
                    let modCount = 0;
                    for (const ch of mod.chapters) {
                        const sourceChapterId = ch.sourceChapterId;
                        const sectionIds = ch.sections.map((s) => s.id);
                        const chCount = sectionIds.filter((sid) => progressSectionIds.has(sid)).length;
                        progressByChapter.set(sourceChapterId, chCount);
                        modCount += chCount;
                    }
                    progressByModule.set(sourceModuleId, modCount);
                }
                let modules = this.courseVersionService.buildUserModulesFromVersion(curriculum.tree, progressByChapter, progressByModule);
                const quizByChapter = new Map(quizProgressRows.map((q) => [q.chapterId, q]));
                modules = modules.map((mod) => ({
                    ...mod,
                    chapters: mod.chapters.map((ch) => ({
                        ...ch,
                        QuizProgress: quizByChapter.has(ch.id)
                            ? [quizByChapter.get(ch.id)]
                            : [],
                    })),
                }));
                if (isFrozen) {
                    for (const mod of modules) {
                        if (mod._count?.sections != null) {
                            mod._count.UserCourseProgress = mod._count.sections;
                        }
                        for (const chapter of mod.chapters ?? []) {
                            if (chapter._count?.sections != null) {
                                chapter._count.UserCourseProgress = chapter._count.sections;
                            }
                        }
                    }
                }
                return {
                    message: 'Successfully fetched all Modules info against course',
                    statusCode: 200,
                    data: modules,
                    isCompleted: isFrozen,
                    completedAt: completion?.courseCompletedAt ?? null,
                    enrolledVersionNumber: curriculum.versionNumber,
                    ...(newSinceCompletion ? { newSinceCompletion } : {}),
                };
            }
            const [courses] = await Promise.all([
                this.prisma.course.findFirst({
                    where: { id },
                    select: {
                        id: true,
                        title: true,
                        modules: {
                            where: { isArchived: false },
                            select: {
                                id: true,
                                title: true,
                                chapters: {
                                    where: { isArchived: false },
                                    select: {
                                        id: true,
                                        title: true,
                                        _count: {
                                            select: {
                                                UserCourseProgress: {
                                                    where: {
                                                        userId,
                                                        Section: {
                                                            isArchived: false,
                                                            isActive: true,
                                                        },
                                                    },
                                                },
                                                sections: {
                                                    where: { isArchived: false, isActive: true },
                                                },
                                                quizzes: { where: { isArchived: false } },
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
                                            where: {
                                                userId,
                                                Section: {
                                                    isArchived: false,
                                                    isActive: true,
                                                },
                                            },
                                        },
                                        sections: {
                                            where: { isArchived: false, isActive: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                }),
            ]);
            if (isFrozen && courses?.modules) {
                for (const mod of courses.modules) {
                    if (mod._count?.sections != null) {
                        mod._count.UserCourseProgress = mod._count.sections;
                    }
                    for (const chapter of mod.chapters ?? []) {
                        if (chapter._count?.sections != null) {
                            chapter._count.UserCourseProgress = chapter._count.sections;
                        }
                    }
                }
            }
            return {
                message: 'Successfully fetched all Modules info against course',
                statusCode: 200,
                data: courses?.modules,
                isCompleted: isFrozen,
                completedAt: completion?.courseCompletedAt ?? null,
                ...(newSinceCompletion ? { newSinceCompletion } : {}),
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
                    isArchived: false,
                },
                include: {
                    _count: {
                        select: {
                            sections: { where: { isArchived: false } },
                            quizzes: { where: { isArchived: false } },
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
                    isArchived: false,
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
            const [userCourseProgress, lastSeenLesson, completion, curriculum] = await Promise.all([
                this.prisma.userCourseProgress.findMany({
                    where: { userId, courseId, chapterId: id },
                }),
                this.prisma.lastSeenSection.findUnique({
                    where: { userId_chapterId: { userId, chapterId: id } },
                }),
                this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId } },
                    select: { courseCompletedAt: true },
                }),
                this.courseVersionService.resolveCurriculumTree(userId, courseId),
            ]);
            const newSinceCompletion = await this.courseVersionService.summarizeNewSincePinnedVersion(userId, courseId);
            if (curriculum.mode === 'versioned') {
                const found = this.courseVersionService.findVersionChapterBySourceId(curriculum.tree, id);
                if (!found) {
                    throw new Error('Chapter not found in enrolled course version');
                }
                const { chapter: versionChapter } = found;
                const allSections = this.courseVersionService.mapVersionSectionsForLearner(versionChapter.sections);
                const completedSections = userCourseProgress ?? [];
                allSections.forEach((section) => {
                    const isCompleted = completedSections.some((completedSection) => completedSection.sectionId === section.id);
                    section.isLastSeen = lastSeenLesson?.sectionId === section.id;
                    section.isCompleted = isCompleted;
                    if (section.type === dto_1.SectionType.ORDERING ||
                        section.type === dto_1.SectionType.MATCHING) {
                        this.sanitizeLessonSectionForStudent(section);
                    }
                });
                if (allSections.length === 0) {
                    throw new Error('No Sections found');
                }
                const quizzes = this.courseVersionService.mapVersionQuizzesForLearner(versionChapter.quizzes, false);
                return {
                    message: 'Successfully fetch all Sections info against chapter',
                    statusCode: 200,
                    data: allSections,
                    chapter: {
                        id,
                        title: versionChapter.title,
                        description: versionChapter.description,
                        pdfFile: versionChapter.pdfFile,
                        moduleId: found.module.sourceModuleId,
                        quizzes,
                    },
                    isCompleted: !!completion?.courseCompletedAt,
                    completedAt: completion?.courseCompletedAt ?? null,
                    enrolledVersionNumber: curriculum.versionNumber,
                    ...(newSinceCompletion ? { newSinceCompletion } : {}),
                };
            }
            const [sections, chapter] = await Promise.all([
                this.prisma.section.findMany({
                    where: { chapterId: id, isArchived: false, isActive: true },
                    orderBy: {
                        createdAt: 'asc',
                    },
                }),
                this.prisma.chapter.findUnique({
                    where: { id },
                    include: {
                        quizzes: {
                            where: { isArchived: false },
                            select: {
                                id: true,
                                question: true,
                                options: true,
                                answer: true,
                            },
                        },
                    },
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
                isCompleted: !!completion?.courseCompletedAt,
                completedAt: completion?.courseCompletedAt ?? null,
                ...(newSinceCompletion ? { newSinceCompletion } : {}),
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (body.description !== undefined) {
                (0, reject_inline_base64_1.assertNoInlineBase64)(body.description);
                updateData.description = body.description;
            }
            if (body.shortDescription !== undefined) {
                (0, reject_inline_base64_1.assertNoInlineBase64)(body.shortDescription, 'shortDescription');
                updateData.shortDescription = body.shortDescription;
            }
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
    async deleteModule(id, adminId) {
        try {
            const mod = await this.prisma.module.findUnique({
                where: { id },
            });
            if (!mod) {
                throw new Error('Module not found');
            }
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('module', id, mod.courseId);
            const referenced = references.versions.length > 0;
            if (referenced) {
                const archived = await this.prisma.module.update({
                    where: { id },
                    data: { isArchived: true, archivedAt: new Date() },
                });
                const publishedVersion = await this.autoPublishAfterStructureChange(mod.courseId, adminId, `Archived module "${mod.title}"`);
                await this.writeArchiveAudit({
                    adminId,
                    entity: 'Module',
                    targetId: id,
                    courseId: mod.courseId,
                    title: mod.title,
                    stillServedTo: references.stillServedTo,
                    versions: references.versions,
                });
                return {
                    message: this.buildArchiveMessage('Module', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: archived,
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.module.delete({
                where: { id },
            });
            const publishedVersion = await this.autoPublishAfterStructureChange(mod.courseId, adminId, `Removed module "${mod.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully deleted module (published v${publishedVersion.versionNumber})`
                    : 'Successfully deleted module record',
                statusCode: 200,
                data: mod,
                outcome: 'deleted',
                stillServedTo: 0,
                publishedVersion: publishedVersion ?? undefined,
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
    async deleteChapter(id, adminId) {
        try {
            const chapter = await this.prisma.chapter.findUnique({
                where: { id },
            });
            if (!chapter) {
                throw new Error('Chapter not found');
            }
            const courseId = await this.resolveCourseIdFromModuleId(chapter.moduleId);
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('chapter', id, courseId);
            const referenced = references.versions.length > 0;
            if (referenced) {
                const archived = await this.prisma.chapter.update({
                    where: { id },
                    data: { isArchived: true, archivedAt: new Date() },
                });
                const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Archived chapter "${chapter.title}"`);
                await this.writeArchiveAudit({
                    adminId,
                    entity: 'Chapter',
                    targetId: id,
                    courseId,
                    title: chapter.title,
                    stillServedTo: references.stillServedTo,
                    versions: references.versions,
                });
                return {
                    message: this.buildArchiveMessage('Chapter', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: archived,
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.chapter.delete({
                where: { id },
            });
            const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Removed chapter "${chapter.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully deleted chapter (published v${publishedVersion.versionNumber})`
                    : 'Successfully deleted chapter record',
                statusCode: 200,
                data: chapter,
                outcome: 'deleted',
                stillServedTo: 0,
                publishedVersion: publishedVersion ?? undefined,
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
    async deleteSection(id, adminId) {
        try {
            const section = await this.prisma.section.findUnique({
                where: { id },
            });
            if (!section) {
                throw new Error('Section not found');
            }
            const courseId = await this.resolveCourseIdFromChapterId(section.chapterId);
            if (section.isArchived) {
                const stillReferenced = await this.courseVersionService.isReferencedByAnyVersion('section', id, courseId);
                if (stillReferenced) {
                    return {
                        message: 'Archived section is still referenced by a published version and cannot be removed',
                        statusCode: 200,
                        data: section,
                    };
                }
                await this.prisma.section.delete({ where: { id } });
                return {
                    message: 'Archived section permanently removed',
                    statusCode: 200,
                    data: section,
                };
            }
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('section', id, courseId);
            const referenced = references.versions.length > 0;
            if (referenced) {
                const archived = await this.prisma.section.update({
                    where: { id },
                    data: { isArchived: true, archivedAt: new Date() },
                });
                const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Archived section "${section.title}"`);
                await this.writeArchiveAudit({
                    adminId,
                    entity: 'Section',
                    targetId: id,
                    courseId,
                    title: section.title,
                    stillServedTo: references.stillServedTo,
                    versions: references.versions,
                });
                return {
                    message: this.buildArchiveMessage('Section', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: archived,
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.section.delete({
                where: { id },
            });
            const publishedVersion = await this.autoPublishAfterStructureChange(courseId, adminId, `Removed section "${section.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully deleted section (published v${publishedVersion.versionNumber})`
                    : 'Successfully deleted section record',
                statusCode: 200,
                data: section,
                outcome: 'deleted',
                stillServedTo: 0,
                publishedVersion: publishedVersion ?? undefined,
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
    async restoreModule(id, adminId) {
        const mod = await this.prisma.module.findUnique({
            where: { id },
            select: { id: true, courseId: true, isArchived: true, title: true },
        });
        if (!mod) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Module not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!mod.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'Cannot restore: Module is already live (not archived)',
                details: { id: mod.id, isArchived: false },
            }, common_1.HttpStatus.CONFLICT);
        }
        const restored = await this.prisma.module.update({
            where: { id },
            data: { isArchived: false, archivedAt: null },
        });
        const latest = await this.courseVersionService.getLatestPublishedVersion(mod.courseId);
        const publishedInLatest = this._isRowInVersion(latest, 'module', id);
        if (adminId) {
            await this.courseVersionService.writeAudit({
                adminId,
                action: 'RESTORE_ENTITY',
                targetType: 'Module',
                targetId: id,
                courseId: mod.courseId,
                metadata: {
                    entityType: 'module',
                    priorIsArchived: true,
                    parentWasArchived: false,
                    publishedInLatest,
                    title: mod.title,
                },
            });
        }
        return {
            message: 'Restored',
            statusCode: 200,
            data: {
                ...restored,
                entityType: 'module',
                latestPublishedVersionId: latest?.id ?? null,
                latestPublishedVersionNumber: latest?.versionNumber ?? null,
                publishedInLatest,
                note: publishedInLatest
                    ? undefined
                    : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
            },
        };
    }
    async restoreChapter(id, adminId) {
        const chapter = await this.prisma.chapter.findUnique({
            where: { id },
            select: {
                id: true,
                moduleId: true,
                isArchived: true,
                title: true,
                module: {
                    select: {
                        id: true,
                        isArchived: true,
                        title: true,
                        courseId: true,
                    },
                },
            },
        });
        if (!chapter) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Chapter not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!chapter.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'Cannot restore: Chapter is already live (not archived)',
                details: { id: chapter.id, isArchived: false },
            }, common_1.HttpStatus.CONFLICT);
        }
        if (chapter.module?.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: `Cannot restore: parent Module "${chapter.module.title}" is archived; restore the module first`,
                details: {
                    parentEntityType: 'module',
                    parentId: chapter.module.id,
                    parentTitle: chapter.module.title,
                    chain: [
                        {
                            entityType: 'module',
                            id: chapter.module.id,
                            title: chapter.module.title,
                        },
                    ],
                },
            }, common_1.HttpStatus.CONFLICT);
        }
        const restored = await this.prisma.chapter.update({
            where: { id },
            data: { isArchived: false, archivedAt: null },
        });
        const courseId = chapter.module?.courseId ?? '';
        const latest = courseId
            ? await this.courseVersionService.getLatestPublishedVersion(courseId)
            : null;
        const publishedInLatest = this._isRowInVersion(latest, 'chapter', id);
        if (adminId) {
            await this.courseVersionService.writeAudit({
                adminId,
                action: 'RESTORE_ENTITY',
                targetType: 'Chapter',
                targetId: id,
                courseId,
                metadata: {
                    entityType: 'chapter',
                    priorIsArchived: true,
                    parentWasArchived: false,
                    publishedInLatest,
                    title: chapter.title,
                },
            });
        }
        return {
            message: 'Restored',
            statusCode: 200,
            data: {
                ...restored,
                entityType: 'chapter',
                latestPublishedVersionId: latest?.id ?? null,
                latestPublishedVersionNumber: latest?.versionNumber ?? null,
                publishedInLatest,
                note: publishedInLatest
                    ? undefined
                    : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
            },
        };
    }
    async restoreSection(id, adminId) {
        const section = await this.prisma.section.findUnique({
            where: { id },
            select: {
                id: true,
                chapterId: true,
                isArchived: true,
                title: true,
                chapter: {
                    select: {
                        id: true,
                        isArchived: true,
                        title: true,
                        module: {
                            select: {
                                id: true,
                                isArchived: true,
                                title: true,
                                courseId: true,
                            },
                        },
                    },
                },
            },
        });
        if (!section) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Section not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!section.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'Cannot restore: Section is already live (not archived)',
                details: { id: section.id, isArchived: false },
            }, common_1.HttpStatus.CONFLICT);
        }
        const chain = [];
        if (section.chapter?.module?.isArchived) {
            chain.push({
                entityType: 'module',
                id: section.chapter.module.id,
                title: section.chapter.module.title,
            });
        }
        if (section.chapter?.isArchived) {
            chain.push({
                entityType: 'chapter',
                id: section.chapter.id,
                title: section.chapter.title,
            });
        }
        if (chain.length > 0) {
            const highest = chain[0];
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: `Cannot restore: parent ${highest.entityType === 'module' ? 'Module' : 'Chapter'} "${highest.title}" is archived; restore the ${highest.entityType} first`,
                details: {
                    parentEntityType: highest.entityType,
                    parentId: highest.id,
                    parentTitle: highest.title,
                    chain,
                },
            }, common_1.HttpStatus.CONFLICT);
        }
        const restored = await this.prisma.section.update({
            where: { id },
            data: { isArchived: false, archivedAt: null },
        });
        const courseId = section.chapter?.module?.courseId ?? '';
        const latest = courseId
            ? await this.courseVersionService.getLatestPublishedVersion(courseId)
            : null;
        const publishedInLatest = this._isRowInVersion(latest, 'section', id);
        if (adminId) {
            await this.courseVersionService.writeAudit({
                adminId,
                action: 'RESTORE_ENTITY',
                targetType: 'Section',
                targetId: id,
                courseId,
                metadata: {
                    entityType: 'section',
                    priorIsArchived: true,
                    parentWasArchived: false,
                    publishedInLatest,
                    title: section.title,
                },
            });
        }
        return {
            message: 'Restored',
            statusCode: 200,
            data: {
                ...restored,
                entityType: 'section',
                latestPublishedVersionId: latest?.id ?? null,
                latestPublishedVersionNumber: latest?.versionNumber ?? null,
                publishedInLatest,
                note: publishedInLatest
                    ? undefined
                    : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
            },
        };
    }
    _isRowInVersion(version, table, sourceId) {
        if (!version)
            return false;
        const parsed = (0, course_version_manifest_1.parseManifest)(version.manifest);
        return parsed ? (0, course_version_manifest_1.isIdReferencedInManifest)(parsed, table, sourceId) : false;
    }
    async getArchivedInventory(courseId, opts) {
        const page = Math.max(1, opts.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
        const search = opts.search?.trim() || undefined;
        const sort = opts.sort || 'archivedAt:desc';
        const searchWhere = search
            ? { title: { contains: search, mode: 'insensitive' } }
            : {};
        const wantModule = !opts.entityType || opts.entityType === 'module';
        const wantChapter = !opts.entityType || opts.entityType === 'chapter';
        const wantSection = !opts.entityType || opts.entityType === 'section';
        const wantQuiz = !opts.entityType || opts.entityType === 'quiz';
        const [modules, chapters, sections, quizzes] = await Promise.all([
            wantModule
                ? this.prisma.module.findMany({
                    where: { courseId, isArchived: true, ...searchWhere },
                    select: {
                        id: true,
                        title: true,
                        archivedAt: true,
                        updatedAt: true,
                    },
                })
                : Promise.resolve([]),
            wantChapter
                ? this.prisma.chapter.findMany({
                    where: {
                        module: { courseId },
                        isArchived: true,
                        ...searchWhere,
                    },
                    select: {
                        id: true,
                        title: true,
                        archivedAt: true,
                        updatedAt: true,
                        module: {
                            select: { id: true, title: true, isArchived: true },
                        },
                    },
                })
                : Promise.resolve([]),
            wantSection
                ? this.prisma.section.findMany({
                    where: {
                        chapter: { module: { courseId } },
                        isArchived: true,
                        ...searchWhere,
                    },
                    select: {
                        id: true,
                        title: true,
                        archivedAt: true,
                        updatedAt: true,
                        chapter: {
                            select: {
                                id: true,
                                title: true,
                                isArchived: true,
                                module: {
                                    select: { id: true, title: true, isArchived: true },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
            wantQuiz
                ? this.prisma.quiz.findMany({
                    where: {
                        chapter: { module: { courseId } },
                        isArchived: true,
                        ...(search
                            ? { question: { contains: search, mode: 'insensitive' } }
                            : {}),
                    },
                    select: {
                        id: true,
                        question: true,
                        archivedAt: true,
                        updatedAt: true,
                        chapter: {
                            select: {
                                id: true,
                                title: true,
                                isArchived: true,
                                module: {
                                    select: { id: true, title: true, isArchived: true },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
        ]);
        const effArchivedAt = (r) => r.archivedAt ?? r.updatedAt;
        const flat = [
            ...modules.map((m) => ({
                id: m.id,
                entityType: 'module',
                title: m.title,
                parentPath: null,
                parentIsArchived: false,
                parentId: null,
                parentEntityType: null,
                archivedAt: effArchivedAt(m),
                stillServedTo: 0,
                versionsReferencing: [],
            })),
            ...chapters.map((c) => ({
                id: c.id,
                entityType: 'chapter',
                title: c.title,
                parentPath: c.module.title,
                parentIsArchived: c.module.isArchived,
                parentId: c.module.isArchived ? c.module.id : null,
                parentEntityType: c.module.isArchived ? 'module' : null,
                archivedAt: effArchivedAt(c),
                stillServedTo: 0,
                versionsReferencing: [],
            })),
            ...sections.map((s) => ({
                id: s.id,
                entityType: 'section',
                title: s.title,
                parentPath: `${s.chapter.module.title} › ${s.chapter.title}`,
                parentIsArchived: s.chapter.module.isArchived || s.chapter.isArchived,
                parentId: s.chapter.module.isArchived
                    ? s.chapter.module.id
                    : s.chapter.isArchived
                        ? s.chapter.id
                        : null,
                parentEntityType: s.chapter.module.isArchived
                    ? 'module'
                    : s.chapter.isArchived
                        ? 'chapter'
                        : null,
                archivedAt: effArchivedAt(s),
                stillServedTo: 0,
                versionsReferencing: [],
            })),
            ...quizzes.map((q) => ({
                id: q.id,
                entityType: 'quiz',
                title: q.question.length > 100 ? q.question.slice(0, 100) + '…' : q.question,
                parentPath: q.chapter
                    ? `${q.chapter.module.title} › ${q.chapter.title}`
                    : null,
                parentIsArchived: q.chapter
                    ? q.chapter.module.isArchived || q.chapter.isArchived
                    : false,
                parentId: q.chapter
                    ? q.chapter.module.isArchived
                        ? q.chapter.module.id
                        : q.chapter.isArchived
                            ? q.chapter.id
                            : null
                    : null,
                parentEntityType: q.chapter
                    ? q.chapter.module.isArchived
                        ? 'module'
                        : q.chapter.isArchived
                            ? 'chapter'
                            : null
                    : null,
                archivedAt: effArchivedAt(q),
                stillServedTo: 0,
                versionsReferencing: [],
            })),
        ];
        const idsByType = new Map();
        for (const row of flat) {
            const bucket = idsByType.get(row.entityType) ?? [];
            bucket.push(row.id);
            idsByType.set(row.entityType, bucket);
        }
        const referencesByType = new Map();
        for (const [type, ids] of idsByType) {
            if (ids.length === 0)
                continue;
            const map = await this.courseVersionService.getReferencingVersionsWithEnrollmentsBatch(type, ids, courseId);
            referencesByType.set(type, map);
        }
        for (const row of flat) {
            const map = referencesByType.get(row.entityType);
            const ref = map?.get(row.id);
            if (ref) {
                row.stillServedTo = ref.stillServedTo;
                row.versionsReferencing = ref.versions;
            }
        }
        const [sortKey, sortDirRaw] = sort.split(':');
        const sortDir = sortDirRaw === 'asc' ? 1 : -1;
        flat.sort((a, b) => {
            if (sortKey === 'title') {
                return a.title.localeCompare(b.title) * sortDir;
            }
            if (sortKey === 'stillServedTo') {
                return (a.stillServedTo - b.stillServedTo) * sortDir;
            }
            const aTime = a.archivedAt?.getTime() ?? -Infinity;
            const bTime = b.archivedAt?.getTime() ?? -Infinity;
            return (aTime - bTime) * sortDir;
        });
        const total = flat.length;
        const paged = flat.slice((page - 1) * pageSize, page * pageSize);
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                rows: paged,
                total,
                page,
                pageSize,
            },
        };
    }
    async assignCourse(userId, courseId) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Course not found.' }, common_1.HttpStatus.NOT_FOUND);
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'User not found.' }, common_1.HttpStatus.NOT_FOUND);
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'This course is already assigned to this user. No changes were made.',
                }, common_1.HttpStatus.CONFLICT);
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'This course is already assigned to this user. No changes were made.',
                }, common_1.HttpStatus.CONFLICT);
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: error instanceof Error ? error.message : 'Something went wrong',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
    }
    async assignCoursePublic(userId, courseId) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Course not found.' }, common_1.HttpStatus.NOT_FOUND);
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'User not found.' }, common_1.HttpStatus.NOT_FOUND);
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
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'This course is already assigned to this user. No changes were made.',
                }, common_1.HttpStatus.CONFLICT);
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'This course is already assigned to this user. No changes were made.',
                }, common_1.HttpStatus.CONFLICT);
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: error instanceof Error ? error.message : 'Something went wrong',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
    }
    async unAssignCourse(userId, courseId, options) {
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
            const residual = await this.probeUserCourseResidualState(userId, courseId);
            if (residual.hasAny && !options?.force) {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: 'Refusing to unassign: learner has progress or completion data. ' +
                        'Deleting the enrollment now would leave orphaned state that ' +
                        'silently re-attaches on re-assignment (progress % may drop, ' +
                        'completion may be re-pinned to a newer version). ' +
                        'Re-send with { force: true } to wipe all learner state for ' +
                        'this course, or use POST /courses/enrollments/migrate-version ' +
                        'to move the learner between versions without touching progress.',
                    details: residual.counts,
                }, common_1.HttpStatus.CONFLICT);
            }
            const wiped = await this.prisma.$transaction(async (tx) => {
                const counts = await this.wipeUserCourseState(tx, userId, courseId, {
                    deleteSectionTimeSpent: true,
                    chapterIds: residual.chapterIds,
                    assessmentIds: residual.assessmentIds,
                });
                await tx.userCourse.delete({ where: { id: userCourse.id } });
                return counts;
            }, { timeout: 15000, maxWait: 5000 });
            if (options?.adminId && (residual.hasAny || options.force)) {
                await this.courseVersionService.writeAudit({
                    adminId: options.adminId,
                    action: residual.hasAny ? 'UNASSIGN_COURSE_FORCE' : 'UNASSIGN_COURSE',
                    targetType: 'UserCourse',
                    targetId: userCourse.id,
                    courseId,
                    userId,
                    metadata: {
                        ...residual.counts,
                        wiped,
                        priorEnrolledVersionId: userCourse.enrolledVersionId,
                    },
                });
            }
            return {
                message: residual.hasAny
                    ? 'Successfully unassigned course and wiped all learner state (force)'
                    : 'Successfully unassigned course from user',
                statusCode: 200,
                data: {
                    wiped: residual.hasAny ? wiped : undefined,
                },
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
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
            const isFirstActivation = isActive && !userCourse.isActive && !userCourse.activatedAt;
            await this.prisma.$transaction(async (tx) => {
                await tx.userCourse.update({
                    where: { id: userCourse.id },
                    data: {
                        isActive,
                        ...(isFirstActivation ? { activatedAt: new Date() } : {}),
                    },
                });
                if (isFirstActivation && !userCourse.enrolledVersionId) {
                    await this.courseVersionService.pinEnrollmentToLatest(userCourse.id, tx);
                }
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
                                where: { isArchived: false },
                                select: {
                                    chapters: {
                                        where: { isArchived: false },
                                        select: {
                                            _count: {
                                                select: {
                                                    sections: {
                                                        where: { isArchived: false, isActive: true },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            _count: {
                                select: {
                                    UserCourseProgress: {
                                        where: {
                                            userId,
                                            Section: { isArchived: false, isActive: true },
                                        },
                                    },
                                },
                            },
                            feedbackForm: {
                                select: { isRequired: true, isActive: true },
                            },
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
            const courseIds = assignedCourses.map((uc) => uc.courseId);
            const [feedbackSubmissions, completions] = await Promise.all([
                this.prisma.courseFeedbackSubmission.findMany({
                    where: { userId, courseId: { in: courseIds } },
                    select: { courseId: true },
                }),
                this.prisma.courseCompletion.findMany({
                    where: { userId, courseId: { in: courseIds } },
                    select: { courseId: true, courseCompletedAt: true },
                }),
            ]);
            const feedbackSubmittedIds = new Set(feedbackSubmissions.map((s) => s.courseId));
            const completedAtByCourse = new Map(completions
                .filter((c) => c.courseCompletedAt)
                .map((c) => [c.courseId, c.courseCompletedAt]));
            const learnerPercentages = await (0, learner_percentage_1.computeLearnerPercentages)(this.prisma, assignedCourses.map((uc) => ({
                userId,
                courseId: uc.courseId,
                enrolledVersionId: uc.enrolledVersionId ?? null,
            })));
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
                const learnerProgress = learnerPercentages.get((0, learner_percentage_1.percentageKey)(userId, course.id));
                const sectionsCount = learnerProgress?.denominator ??
                    (course.modules
                        ?.flatMap((module) => module.chapters)
                        ?.reduce((acc, chapter) => acc + chapter._count.sections, 0) ||
                        0);
                const userCourseProgressCount = learnerProgress?.numerator ?? course._count?.UserCourseProgress ?? 0;
                const latestLastSeenSection = course.LastSeenSection?.[0];
                const formsCompleted = formStatus.totalForms === formStatus.completedForms;
                const canAccessPolicies = formsCompleted;
                const canAccessContent = formsCompleted &&
                    allRequiredItemsCompleted;
                const completedAt = completedAtByCourse.get(course.id);
                const isFrozen = !!completedAt;
                if (completedAt &&
                    learnerProgress &&
                    learnerProgress.percentage < 100 &&
                    learnerProgress.denominator > 0) {
                    CourseService_1.completionLogger.warn(`Percentage invariant: certified learner ${userId} on course ${course.id} computed ` +
                        `${learnerProgress.numerator}/${learnerProgress.denominator} ` +
                        `(source=${learnerProgress.denominatorSource}); frozen to 100 for display.`);
                }
                let expired = false;
                let expiresAt = null;
                if (completedAt) {
                    expiresAt = new Date(completedAt);
                    expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
                    expired = role === 'user' && new Date() > expiresAt;
                }
                return {
                    ...course,
                    isActive,
                    isPaid,
                    expired,
                    expiresAt,
                    isCompleted: isFrozen,
                    completedAt: completedAt ?? null,
                    feedbackForm: course.feedbackForm
                        ? {
                            isRequired: course.feedbackForm.isRequired,
                            isCompleted: feedbackSubmittedIds.has(course.id),
                        }
                        : null,
                    percentage: learnerProgress
                        ? learnerProgress.percentage
                        : isFrozen
                            ? 100
                            : sectionsCount > 0
                                ? (userCourseProgressCount * 100) / sectionsCount
                                : 0,
                    _count: {
                        totalSections: sectionsCount,
                        userCourseProgress: isFrozen
                            ? sectionsCount
                            : Math.min(userCourseProgressCount, sectionsCount),
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
    async updateUserChapterProgress(userId, body, userEmail) {
        try {
            await (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, body.chapterId, userEmail);
            const course = await this.prisma.course.findUnique({
                where: { id: body.courseId },
                select: { id: true },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true },
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
                await this.courseCompletion.checkContentCompletion(userId, body.courseId);
                await (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, userId, body.chapterId, { courseId: body.courseId });
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async _assertEnrollmentUsable(userId, courseId, userRole) {
        const isLearner = userRole === client_1.Role.user;
        const enrollment = await this.prisma.userCourse.findFirst({
            where: isLearner
                ? { userId, courseId, isActive: true }
                : { userId, courseId },
        });
        if (!enrollment) {
            throw new common_1.ForbiddenException({
                detail: 'You are not assigned to this course, or the enrolment is inactive',
            });
        }
        if (isLearner) {
            const [completion, course] = await Promise.all([
                this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId } },
                    select: { courseCompletedAt: true },
                }),
                this.prisma.course.findUnique({
                    where: { id: courseId },
                    select: { validityDays: true },
                }),
            ]);
            if (completion?.courseCompletedAt) {
                const validityDays = course?.validityDays ?? 365;
                const expiresAt = new Date(completion.courseCompletedAt);
                expiresAt.setDate(expiresAt.getDate() + validityDays);
                if (new Date() > expiresAt) {
                    throw new common_1.ForbiddenException({
                        detail: `Your access to this course expired on ${expiresAt.toISOString().split('T')[0]}. Please contact your administrator to renew access.`,
                    });
                }
            }
        }
        return enrollment;
    }
    async getUserChapterProgress(userId, courseId, chapterId) {
        try {
            const [userCourseProgress, completion, curriculum] = await Promise.all([
                this.prisma.userCourseProgress.findMany({
                    where: {
                        userId,
                        courseId,
                        chapterId,
                    },
                }),
                this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId } },
                    select: { courseCompletedAt: true },
                }),
                this.courseVersionService.resolveCurriculumTree(userId, courseId),
            ]);
            const newSinceCompletion = await this.courseVersionService.summarizeNewSincePinnedVersion(userId, courseId);
            if (curriculum.mode === 'versioned') {
                const found = this.courseVersionService.findVersionChapterBySourceId(curriculum.tree, chapterId);
                if (!found) {
                    throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Chapter not found' }, common_1.HttpStatus.NOT_FOUND);
                }
                const versionSectionIds = found.chapter.sections.map((s) => s.id);
                const totalSections = versionSectionIds.length;
                const progressSectionIds = new Set(userCourseProgress.map((p) => p.sectionId));
                const completedSections = Math.min(versionSectionIds.filter((id) => progressSectionIds.has(id)).length, totalSections);
                const isFrozen = !!completion?.courseCompletedAt;
                let percentage = 0;
                if (isFrozen) {
                    percentage = 100;
                }
                else if (totalSections > 0) {
                    percentage = (completedSections * 100) / totalSections;
                }
                return {
                    message: 'User course progress updated successfully',
                    statusCode: 200,
                    data: {
                        userCourseProgress: percentage,
                        courseProgressData: userCourseProgress,
                        totalSections,
                        completedSections: isFrozen ? totalSections : completedSections,
                        isCompleted: isFrozen,
                        completedAt: completion?.courseCompletedAt ?? null,
                        enrolledVersionNumber: curriculum.versionNumber,
                        ...(newSinceCompletion ? { newSinceCompletion } : {}),
                    },
                };
            }
            const chapter = await this.prisma.chapter.findUnique({
                where: { id: chapterId },
                include: {
                    sections: {
                        where: { isArchived: false, isActive: true },
                        select: { id: true },
                    },
                    module: { select: { courseId: true } },
                },
            });
            if (!chapter) {
                throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Chapter not found' }, common_1.HttpStatus.NOT_FOUND);
            }
            if (chapter.module?.courseId !== courseId) {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.BAD_REQUEST,
                    error: 'Chapter does not belong to the specified course',
                }, common_1.HttpStatus.BAD_REQUEST);
            }
            const isFrozen = !!completion?.courseCompletedAt;
            const liveSectionIds = chapter.sections.map((s) => s.id);
            const totalSections = liveSectionIds.length;
            const progressedSectionIds = new Set(userCourseProgress.map((p) => p.sectionId));
            const completedSections = liveSectionIds.filter((sid) => progressedSectionIds.has(sid)).length;
            let percentage = 0;
            if (isFrozen) {
                percentage = 100;
            }
            else if (totalSections > 0) {
                percentage = (completedSections * 100) / totalSections;
            }
            return {
                message: 'User course progress updated successfully',
                statusCode: 200,
                data: {
                    userCourseProgress: percentage,
                    courseProgressData: userCourseProgress,
                    totalSections,
                    completedSections: isFrozen ? totalSections : completedSections,
                    isCompleted: isFrozen,
                    completedAt: completion?.courseCompletedAt ?? null,
                    ...(newSinceCompletion ? { newSinceCompletion } : {}),
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
    async updateLastSeenSection(userId, chapterId, sectionId, moduleId, courseId, userEmail) {
        try {
            await (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, chapterId, userEmail);
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async submitCourseFeedback(studentId, courseId, body) {
        return this.feedbackService.submitCourseFeedback(studentId, courseId, body);
    }
    async getCourseFeedbackStatus(studentId, courseId) {
        return this.feedbackService.getCourseFeedbackStatus(studentId, courseId);
    }
    async getCourseFeedbackSubmissions(courseId, adminId) {
        return this.feedbackService.getCourseFeedbackSubmissions(courseId, adminId);
    }
    async resetUserCourseProgress(adminId, userId, courseId) {
        try {
            const admin = await this.prisma.user.findUnique({
                where: { id: adminId },
                select: { role: true },
            });
            if (!admin || admin.role !== 'admin') {
                throw new common_1.ForbiddenException('Only admins can reset course progress');
            }
            const [user, course] = await Promise.all([
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { id: true, deletedAt: true },
                }),
                this.prisma.course.findUnique({
                    where: { id: courseId },
                    select: { id: true },
                }),
            ]);
            if (!user || user.deletedAt) {
                throw new common_1.BadRequestException('User not found');
            }
            if (!course) {
                throw new common_1.BadRequestException('Course not found');
            }
            const wiped = await this.prisma.$transaction((tx) => this.wipeUserCourseState(tx, userId, courseId, {
                deleteSectionTimeSpent: false,
            }), { timeout: 15000, maxWait: 5000 });
            const deleted = {
                sectionProgress: wiped.sectionProgress,
                lastSeen: wiped.lastSeen,
                quizProgress: wiped.quizProgress,
                quizAnswers: wiped.quizAnswers,
                formCompletions: wiped.formCompletions,
                policyCompletions: wiped.policyCompletions,
                policyItemCompletions: wiped.policyItemCompletions,
                feedbackSubmissions: wiped.feedbackSubmissions,
                courseCompletions: wiped.courseCompletions,
                chapterCompletions: wiped.chapterCompletions,
                moduleCompletions: wiped.moduleCompletions,
                sectionAttemptsReset: wiped.sectionTimeSpent,
                assessmentAttempts: wiped.assessmentAttempts,
            };
            return {
                message: 'User course progress reset successfully',
                statusCode: 200,
                data: { userId, courseId, deleted },
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to reset course progress',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
};
exports.CourseService = CourseService;
CourseService.completionLogger = new common_1.Logger(CourseService_1.name);
exports.CourseService = CourseService = CourseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        mail_service_1.MailService,
        feedback_service_1.FeedbackService,
        course_version_service_1.CourseVersionService,
        course_completion_service_1.CourseCompletionService])
], CourseService);
//# sourceMappingURL=course.service.js.map