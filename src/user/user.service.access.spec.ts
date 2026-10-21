import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { UserService } from './user.service';

describe('UserService access to other users', () => {
  let service: UserService;
  let prisma: Record<string, any>;

  const learner = { id: 'user-1', role: Role.user };
  const admin = { id: 'admin-1', role: Role.admin };

  const enrolledAt = new Date('2026-07-01T00:00:00.000Z');
  const storedUser = {
    id: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    address: null,
    photo: null,
    role: Role.user,
    UserCourse: [
      {
        createdAt: enrolledAt,
        course: {
          id: 'course-1',
          title: 'NEBOSH IGC',
          image: '',
          courseForms: [
            {
              id: 'cf-old',
              formId: 'registration-form',
              formName: 'Registration',
              isRequired: true,
              createdAt: new Date('2026-06-01T00:00:00.000Z'),
              requiredSince: new Date('2026-06-01T00:00:00.000Z'),
              detachedAt: null,
              detachedWindows: null,
              userFormCompletions: [],
            },
            {
              id: 'cf-new',
              formId: 'learner-agreement',
              formName: 'Agreement',
              isRequired: true,
              createdAt: new Date('2026-10-17T00:00:00.000Z'),
              requiredSince: new Date('2026-10-17T00:00:00.000Z'),
              detachedAt: null,
              detachedWindows: null,
              userFormCompletions: [],
            },
          ],
        },
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(storedUser),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: {} },
        { provide: ScormCloudClient, useValue: {} },
      ],
    }).compile();

    service = module.get(UserService);
  });

  describe('getUser', () => {
    it("refuses a learner reading someone else's record", async () => {
      await expect(service.getUser('user-2', learner)).rejects.toMatchObject({
        status: 403,
      });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('shows a learner only the forms that apply to their enrolment', async () => {
      const result = await service.getUser('user-1', learner);

      expect(
        (result.data as any).courses[0].forms.map((f: any) => f.formId),
      ).toEqual(['registration-form']);
      expect((result.data as any).courses[0].totalForms).toBe(1);
    });

    it("shows an admin the learner's own forms, not ones added after they enrolled", async () => {
      const result = await service.getUser('user-1', admin);

      expect(
        (result.data as any).courses[0].forms.map((f: any) => f.formId),
      ).toEqual(['registration-form']);
      expect((result.data as any).courses[0].totalForms).toBe(1);
    });

    it('still shows an admin a later form the learner did submit, not required of them', async () => {
      const course = storedUser.UserCourse[0].course;
      prisma.user.findFirst.mockResolvedValue({
        ...storedUser,
        UserCourse: [
          {
            ...storedUser.UserCourse[0],
            course: {
              ...course,
              courseForms: [
                course.courseForms[0],
                {
                  ...course.courseForms[1],
                  userFormCompletions: [
                    { isComplete: true, completedAt: new Date(), metadata: {} },
                  ],
                },
              ],
            },
          },
        ],
      });

      const result = await service.getUser('user-1', admin);
      const summary = (result.data as any).courses[0];

      expect(
        summary.forms.find((f: any) => f.formId === 'learner-agreement'),
      ).toMatchObject({ isRequired: false, isComplete: true });
      expect(summary.totalForms).toBe(1);
    });

    it('never shows a learner a form removed from the course', async () => {
      await service.getUser('user-1', learner);

      const include = prisma.user.findFirst.mock.calls[0][0].include;
      expect(
        include.UserCourse.include.course.include.courseForms.where,
      ).toEqual({ detachedAt: null });
    });

    it('shows an admin a removed form the learner submitted, flagged and not counted', async () => {
      const removed = {
        id: 'cf-removed',
        formId: 'terms-conditions',
        formName: 'Terms',
        isRequired: true,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        requiredSince: new Date('2026-06-01T00:00:00.000Z'),
        detachedAt: new Date('2026-10-01T00:00:00.000Z'),
        detachedWindows: null,
        userFormCompletions: [
          { isComplete: true, completedAt: new Date(), metadata: {} },
        ],
      };
      const course = storedUser.UserCourse[0].course;
      prisma.user.findFirst.mockResolvedValue({
        ...storedUser,
        UserCourse: [
          {
            ...storedUser.UserCourse[0],
            course: {
              ...course,
              courseForms: [...course.courseForms, removed],
            },
          },
        ],
      });

      const result = await service.getUser('user-1', admin);
      const summary = (result.data as any).courses[0];

      expect(
        summary.forms.find((f: any) => f.formId === 'terms-conditions'),
      ).toMatchObject({ isDetached: true, isComplete: true });
      expect(summary.totalForms).toBe(1);
      expect(summary.completedForms).toBe(0);
    });
  });

  describe('changePassword', () => {
    it("refuses changing someone else's password", async () => {
      await expect(
        service.changePassword(learner, 'admin-1', {
          oldPassword: 'x',
          password: 'y',
        } as never),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getAllUsers', () => {
    it('never returns password hashes', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'jane@example.com',
          password: 'hash',
          UserCourse: [],
        },
      ]);

      const result = await service.getAllUsers();

      expect((result.data as any)[0]).not.toHaveProperty('password');
      expect((result.data as any)[0].email).toBe('jane@example.com');
    });
  });
});
