import {
  ForumCourseScope,
  ForumNotifyOnCreate,
  ForumStudentCreatePolicy,
  Role,
} from '@prisma/client';

export type ForumCategoryPolicy = {
  id: string;
  isActive: boolean;
  courseScope: ForumCourseScope;
  studentCreatePolicy: ForumStudentCreatePolicy;
  notifyOnCreate: ForumNotifyOnCreate;
  allowAcceptedAnswer?: boolean;
  allowVotes?: boolean;
  allowMentions?: boolean;
};

export function isAdminRole(role: Role | string | undefined): boolean {
  return role === Role.admin || role === 'admin';
}

export function slugifyCategoryName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'category';
}

/** Throws a plain Error; callers map it to HttpException. */
export function assertCourseScope(
  category: ForumCategoryPolicy,
  courseId: string | null | undefined,
): void {
  const hasCourse = Boolean(courseId);
  if (category.courseScope === ForumCourseScope.REQUIRED && !hasCourse) {
    throw new Error('courseId is required for this category');
  }
  if (category.courseScope === ForumCourseScope.FORBIDDEN && hasCourse) {
    throw new Error('This category does not allow a course on the thread');
  }
}

export function assertStudentMayCreate(
  category: ForumCategoryPolicy,
  role: Role | string,
): void {
  if (isAdminRole(role)) return;
  if (!category.isActive) {
    throw new Error('This category is not accepting new threads');
  }
  if (category.studentCreatePolicy === ForumStudentCreatePolicy.DISABLED) {
    throw new Error('Students cannot create threads in this category');
  }
}

export function resolveNewThreadStatus(args: {
  role: Role | string;
  category: ForumCategoryPolicy;
  requestedStatus?: string;
}): string {
  if (isAdminRole(args.role)) {
    if (args.requestedStatus === 'inActive' || args.requestedStatus === 'active') {
      return args.requestedStatus;
    }
    return 'active';
  }
  if (args.category.studentCreatePolicy === ForumStudentCreatePolicy.MODERATED) {
    return 'inActive';
  }
  return 'active';
}

export function shouldBroadcastNewThread(args: {
  role: Role | string;
  category: ForumCategoryPolicy;
  status: string;
}): boolean {
  if (args.status !== 'active') return false;
  if (args.category.notifyOnCreate === ForumNotifyOnCreate.NONE) return false;
  if (args.category.notifyOnCreate === ForumNotifyOnCreate.ALL) return true;
  return isAdminRole(args.role);
}

type ForumEngagementFlags = {
  allowAcceptedAnswer?: boolean;
  allowVotes?: boolean;
  allowMentions?: boolean;
};

/** Missing category (uncategorized thread) keeps features on. */
export function categoryAllows(
  category: ForumCategoryPolicy | ForumEngagementFlags | null | undefined,
  flag: keyof ForumEngagementFlags,
): boolean {
  if (!category) return true;
  return category[flag] !== false;
}
