import {
  ForumCourseScope,
  ForumNotifyOnCreate,
  ForumStudentCreatePolicy,
  Role,
} from '@prisma/client';
import {
  assertCourseScope,
  assertStudentMayCreate,
  categoryAllows,
  resolveNewThreadStatus,
  shouldBroadcastNewThread,
  slugifyCategoryName,
} from './forum-policy';

const study = {
  id: 'study',
  isActive: true,
  courseScope: ForumCourseScope.REQUIRED,
  studentCreatePolicy: ForumStudentCreatePolicy.ALLOWED,
  notifyOnCreate: ForumNotifyOnCreate.ADMIN_ONLY,
  allowAcceptedAnswer: true,
  allowVotes: true,
  allowMentions: true,
};

describe('forum-policy', () => {
  it('slugifies names', () => {
    expect(slugifyCategoryName('Support Forum')).toBe('support-forum');
  });

  it('requires a course only when the category says so', () => {
    expect(() => assertCourseScope(study, null)).toThrow(/courseId is required/);
    expect(() => assertCourseScope(study, 'course-1')).not.toThrow();
    expect(() =>
      assertCourseScope(
        { ...study, courseScope: ForumCourseScope.OPTIONAL },
        null,
      ),
    ).not.toThrow();
    expect(() =>
      assertCourseScope(
        { ...study, courseScope: ForumCourseScope.FORBIDDEN },
        'course-1',
      ),
    ).toThrow(/does not allow a course/);
  });

  it('lets admins always create; students follow the category policy', () => {
    expect(() => assertStudentMayCreate(study, Role.admin)).not.toThrow();
    expect(() => assertStudentMayCreate(study, Role.user)).not.toThrow();
    expect(() =>
      assertStudentMayCreate(
        { ...study, studentCreatePolicy: ForumStudentCreatePolicy.DISABLED },
        Role.user,
      ),
    ).toThrow(/cannot create/);
  });

  it('publishes student threads live unless the board is moderated', () => {
    expect(
      resolveNewThreadStatus({ role: Role.user, category: study }),
    ).toBe('active');
    expect(
      resolveNewThreadStatus({
        role: Role.user,
        category: {
          ...study,
          studentCreatePolicy: ForumStudentCreatePolicy.MODERATED,
        },
      }),
    ).toBe('inActive');
    expect(
      resolveNewThreadStatus({
        role: Role.admin,
        category: study,
        requestedStatus: 'inActive',
      }),
    ).toBe('inActive');
  });

  it('broadcasts admin publishes by default, not student posts', () => {
    expect(
      shouldBroadcastNewThread({
        role: Role.admin,
        category: study,
        status: 'active',
      }),
    ).toBe(true);
    expect(
      shouldBroadcastNewThread({
        role: Role.user,
        category: study,
        status: 'active',
      }),
    ).toBe(false);
    expect(
      shouldBroadcastNewThread({
        role: Role.user,
        category: { ...study, notifyOnCreate: ForumNotifyOnCreate.ALL },
        status: 'active',
      }),
    ).toBe(true);
    expect(
      shouldBroadcastNewThread({
        role: Role.admin,
        category: { ...study, notifyOnCreate: ForumNotifyOnCreate.NONE },
        status: 'active',
      }),
    ).toBe(false);
  });

  it('keeps engagement features on when the category is missing or the flag is unset', () => {
    expect(categoryAllows(null, 'allowVotes')).toBe(true);
    expect(categoryAllows(study, 'allowMentions')).toBe(true);
    expect(
      categoryAllows({ ...study, allowVotes: false }, 'allowVotes'),
    ).toBe(false);
  });
});
