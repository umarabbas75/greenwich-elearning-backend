import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SectionType } from '@prisma/client';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import {
  assertChapterAccessible,
  recordChapterAndModuleCompletionIfNeeded,
} from '../utils/chapter-progression';
import { CourseService } from './course.service';

jest.mock('../utils/chapter-progression', () => ({
  assertChapterAccessible: jest.fn().mockResolvedValue(undefined),
  recordChapterAndModuleCompletionIfNeeded: jest.fn().mockResolvedValue(undefined),
}));

const BODY = {
  courseId: 'course-1',
  chapterId: 'ch-1',
  sectionId: 'sec-1',
  moduleId: 'mod-1',
};

const EXISTING_ROW = {
  id: 'progress-1',
  userId: 'user-1',
  ...BODY,
};

describe('CourseService.updateUserChapterProgress', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let courseCompletion: { checkContentCompletion: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    courseCompletion = { checkContentCompletion: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      userCourseProgress: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          moduleId: 'mod-1',
          module: { courseId: 'course-1' },
        }),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'course-1',
          deliveryMode: 'NATIVE',
        }),
      },
      section: {
        findUnique: jest.fn().mockResolvedValue({ type: SectionType.DEFAULT }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: {} },
        { provide: FeedbackService, useValue: {} },
        { provide: CourseVersionService, useValue: {} },
        { provide: CourseCompletionService, useValue: courseCompletion },
        { provide: NotificationService, useValue: {} },
        {
          provide: ScormCloudClient,
          useValue: {
            deleteRegistration: jest.fn().mockResolvedValue(undefined),
            deleteCourse: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(CourseService);
  });

  it('returns the existing row without a gate or completion check', async () => {
    prisma.userCourseProgress.findUnique.mockResolvedValue(EXISTING_ROW);

    const result = await service.updateUserChapterProgress('user-1', BODY, 'a@b.c');

    expect(result.data).toEqual({ userCourseProgress: EXISTING_ROW });
    expect(assertChapterAccessible).not.toHaveBeenCalled();
    expect(prisma.userCourseProgress.create).not.toHaveBeenCalled();
    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
    expect(recordChapterAndModuleCompletionIfNeeded).not.toHaveBeenCalled();
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it('creates a new row and runs completion bookkeeping in parallel', async () => {
    prisma.userCourseProgress.findUnique.mockResolvedValue(null);
    prisma.userCourseProgress.create.mockResolvedValue(EXISTING_ROW);

    const result = await service.updateUserChapterProgress('user-1', BODY, 'a@b.c');

    expect(result.data).toEqual({ userCourseProgress: EXISTING_ROW });
    expect(assertChapterAccessible).toHaveBeenCalledWith(
      prisma,
      expect.anything(),
      'user-1',
      'ch-1',
      'a@b.c',
      { courseId: 'course-1' },
    );
    expect(courseCompletion.checkContentCompletion).toHaveBeenCalledWith(
      'user-1',
      'course-1',
    );
    expect(recordChapterAndModuleCompletionIfNeeded).toHaveBeenCalled();
  });

  it('rejects imported SCORM courses', async () => {
    prisma.userCourseProgress.findUnique.mockResolvedValue(null);
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: 'IMPORTED_SCORM',
    });

    await expect(
      service.updateUserChapterProgress('user-1', BODY, 'a@b.c'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userCourseProgress.create).not.toHaveBeenCalled();
  });

  it('rejects native SCORM sections', async () => {
    prisma.userCourseProgress.findUnique.mockResolvedValue(null);
    prisma.section.findUnique.mockResolvedValue({ type: SectionType.SCORM });

    await expect(
      service.updateUserChapterProgress('user-1', BODY, 'a@b.c'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userCourseProgress.create).not.toHaveBeenCalled();
  });

  it('treats a unique-constraint race as an idempotent success', async () => {
    prisma.userCourseProgress.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(EXISTING_ROW);
    prisma.userCourseProgress.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.updateUserChapterProgress('user-1', BODY, 'a@b.c');

    expect(result.data).toEqual({ userCourseProgress: EXISTING_ROW });
    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
  });
});
