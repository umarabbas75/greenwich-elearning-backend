import { NotificationEmail } from '../mail.types';
import {
  assessmentGrade,
  forumThread,
  studentCourseDetail,
  studentCoursesList,
} from '../mail-paths';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

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
