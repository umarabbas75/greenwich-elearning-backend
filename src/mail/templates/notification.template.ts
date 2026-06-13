import { NotificationEmail } from '../mail.types';
import {
  adminAssignmentSubmissions,
  assessmentGrade,
  forumThread,
  studentAssignmentDetail,
  studentCourseDetail,
  studentCoursesList,
} from '../mail-paths';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

const SUBMISSION_STATUS_COPY: Record<
  'submitted' | 'in_review' | 'approved' | 'rejected' | 'returned',
  { heading: string; sentence: string }
> = {
  submitted: {
    heading: 'Your submission was received',
    sentence: 'has been received and is queued for review',
  },
  in_review: {
    heading: 'Your submission is under review',
    sentence: 'is now being reviewed',
  },
  approved: {
    heading: 'Your submission has been approved',
    sentence: 'has been reviewed and approved',
  },
  rejected: {
    heading: 'Your submission was not accepted',
    sentence: 'has been reviewed and was not accepted',
  },
  returned: {
    heading: 'Your submission was returned for changes',
    sentence: 'was returned with feedback for changes',
  },
};

function formatDueAt(dueAt: string | null | undefined): string {
  if (!dueAt) return '';
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Renders the email mirror of an in-app notification. One branch per
 * NotificationType, each producing { subject, html, text } via the shared
 * branded layout. Deep links are built from BRAND.website so a clicked email
 * lands the user on the right page.
 */
export function renderNotificationEmail(
  mail: NotificationEmail,
): RenderedEmail {
  switch (mail.kind) {
    case 'FORUM_THREAD': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const title = escapeHtml(mail.threadTitle);
      const creator = escapeHtml(mail.creatorName);
      const url = forumThread(mail.threadId);
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">A new discussion, <strong>${title}</strong>, has been posted by ${creator}. Join the conversation when you have a moment.</p>`;
      return {
        subject: `New discussion: ${mail.threadTitle}`,
        html: layout({
          heading: 'New discussion posted',
          bodyHtml: body,
          ctaLabel: 'View discussion',
          ctaUrl: url,
        }),
        text: `Dear ${
          mail.recipientFirstName || 'there'
        },\n\nA new discussion, "${mail.threadTitle}", has been posted by ${
          mail.creatorName
        }.\n\nView it: ${url}\n\nKind regards,\nThe ${BRAND.name} Team`,
      };
    }

    case 'FORUM_COMMENT': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const title = escapeHtml(mail.threadTitle);
      const commenter = escapeHtml(mail.commenterName);
      const excerpt = escapeHtml(mail.excerpt);
      const url = forumThread(mail.threadId);
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${commenter} replied in <strong>${title}</strong>:</p>
        <p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;font-style:italic;">"${excerpt}"</p>`;
      return {
        subject: `New reply in ${mail.threadTitle}`,
        html: layout({
          heading: 'New reply to a discussion',
          bodyHtml: body,
          ctaLabel: 'View reply',
          ctaUrl: url,
        }),
        text: `Dear ${mail.recipientFirstName || 'there'},\n\n${
          mail.commenterName
        } replied in "${mail.threadTitle}":\n"${
          mail.excerpt
        }"\n\nView it: ${url}\n\nKind regards,\nThe ${BRAND.name} Team`,
      };
    }

    case 'ASSESSMENT_SUBMITTED': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const student = escapeHtml(mail.studentName);
      const title = escapeHtml(mail.assessmentTitle);
      const url = assessmentGrade(mail.attemptId);
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${student} has submitted the assessment <strong>${title}</strong> and it is ready for grading.</p>`;
      return {
        subject: `Assessment submitted by ${mail.studentName}`,
        html: layout({
          heading: 'An assessment is ready to grade',
          bodyHtml: body,
          ctaLabel: 'Grade assessment',
          ctaUrl: url,
        }),
        text: `Dear ${mail.recipientFirstName || 'there'},\n\n${
          mail.studentName
        } has submitted the assessment "${
          mail.assessmentTitle
        }" and it is ready for grading.\n\nGrade it: ${url}\n\nKind regards,\nThe ${
          BRAND.name
        } Team`,
      };
    }

    case 'ASSIGNMENT_CREATED': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const title = escapeHtml(mail.assignmentTitle);
      const courseTitle = escapeHtml(mail.courseTitle);
      const url = studentAssignmentDetail(mail.assignmentId);
      const dueLabel = formatDueAt(mail.dueAt);
      const dueLine = dueLabel
        ? `<p style="margin-top:8px;color:${BRAND.muted};font-size:13px;">Due: <strong>${escapeHtml(dueLabel)}</strong></p>`
        : '';
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">A new assignment, <strong>${title}</strong>, has been added to your course <strong>${courseTitle}</strong>.</p>${dueLine}`;
      return {
        subject: `New assignment: ${mail.assignmentTitle}`,
        html: layout({
          heading: 'New assignment available',
          bodyHtml: body,
          ctaLabel: 'View assignment',
          ctaUrl: url,
        }),
        text: `Dear ${
          mail.recipientFirstName || 'there'
        },\n\nA new assignment, "${mail.assignmentTitle}", has been added to your course "${
          mail.courseTitle
        }".${dueLabel ? `\nDue: ${dueLabel}` : ''}\n\nView it: ${url}\n\nKind regards,\nThe ${
          BRAND.name
        } Team`,
      };
    }

    case 'ASSIGNMENT_SUBMITTED': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const student = escapeHtml(mail.studentName);
      const title = escapeHtml(mail.assignmentTitle);
      const url = adminAssignmentSubmissions(mail.assignmentId);
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">${student} has submitted to the assignment <strong>${title}</strong> and it is ready for review.</p>`;
      return {
        subject: `Assignment submitted by ${mail.studentName}`,
        html: layout({
          heading: 'A submission is ready to review',
          bodyHtml: body,
          ctaLabel: 'Review submission',
          ctaUrl: url,
        }),
        text: `Dear ${mail.recipientFirstName || 'there'},\n\n${
          mail.studentName
        } has submitted to the assignment "${
          mail.assignmentTitle
        }" and it is ready for review.\n\nReview it: ${url}\n\nKind regards,\nThe ${
          BRAND.name
        } Team`,
      };
    }

    case 'ASSIGNMENT_GRADED': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const title = escapeHtml(mail.assignmentTitle);
      const url = studentAssignmentDetail(mail.assignmentId);
      const copy = SUBMISSION_STATUS_COPY[mail.submissionStatus];
      const scoreLine =
        typeof mail.score === 'number'
          ? `<p style="margin-top:8px;">Score: <strong>${mail.score}${
              typeof mail.maxPoints === 'number'
                ? ` / ${mail.maxPoints}`
                : ''
            }</strong></p>`
          : '';
      const feedbackLine = mail.feedback
        ? `<p style="margin-top:8px;padding:12px 16px;background:#f4f5f7;border-radius:8px;font-style:italic;">"${escapeHtml(
            mail.feedback,
          )}"</p>`
        : '';
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">Your submission for <strong>${title}</strong> ${copy.sentence}.</p>${scoreLine}${feedbackLine}`;
      return {
        subject: `Update on your submission: ${mail.assignmentTitle}`,
        html: layout({
          heading: copy.heading,
          bodyHtml: body,
          ctaLabel: 'View submission',
          ctaUrl: url,
        }),
        text: `Dear ${
          mail.recipientFirstName || 'there'
        },\n\nYour submission for "${mail.assignmentTitle}" ${copy.sentence}.${
          typeof mail.score === 'number'
            ? `\nScore: ${mail.score}${
                typeof mail.maxPoints === 'number' ? ` / ${mail.maxPoints}` : ''
              }`
            : ''
        }${mail.feedback ? `\nFeedback: ${mail.feedback}` : ''}\n\nView it: ${url}\n\nKind regards,\nThe ${
          BRAND.name
        } Team`,
      };
    }

    case 'ASSESSMENT_GRADED': {
      const name = escapeHtml(mail.recipientFirstName || 'there');
      const title = escapeHtml(mail.assessmentTitle);
      const url = mail.courseId
        ? studentCourseDetail(mail.courseId)
        : studentCoursesList();
      const outcome =
        mail.passed == null
          ? ''
          : mail.passed
            ? ` You <strong>passed</strong>${
                mail.scorePct != null
                  ? ` with ${Math.round(mail.scorePct)}%`
                  : ''
              }. Congratulations!`
            : ` Your score was${
                mail.scorePct != null ? ` ${Math.round(mail.scorePct)}%` : ''
              }.`;
      const body = `<p>Dear ${name},</p>
        <p style="margin-top:12px;">Your assessment <strong>${title}</strong> has been graded.${outcome}</p>`;
      return {
        subject: `Your assessment "${mail.assessmentTitle}" has been graded`,
        html: layout({
          heading: 'Your assessment has been graded',
          bodyHtml: body,
          ctaLabel: 'View result',
          ctaUrl: url,
        }),
        text: `Dear ${
          mail.recipientFirstName || 'there'
        },\n\nYour assessment "${mail.assessmentTitle}" has been graded.${
          mail.passed == null ? '' : mail.passed ? ' You passed!' : ''
        }\n\nView it: ${url}\n\nKind regards,\nThe ${BRAND.name} Team`,
      };
    }
  }
}
