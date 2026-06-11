import {
  CourseCompletedMail,
  FeedbackReceivedAdminMail,
  FeedbackReceivedMail,
  FeedbackRequestMail,
  PendingFeedbackOutstandingMail,
} from '../mail.types';
import {
  adminFeedback,
  studentCourseDetail,
  studentCourseFeedback,
  studentCoursesList,
} from '../mail-paths';
import { BRAND, escapeHtml, layout, RenderedEmail } from './mail-layout';

/** Congratulations on completing a course. */
export function renderCourseCompleted(
  mail: CourseCompletedMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const ctaUrl = mail.courseId
    ? studentCourseFeedback(mail.courseId)
    : studentCoursesList();
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Congratulations on completing <strong>${title}</strong>! You have worked through all of the course content — a real achievement.</p>
    <p style="margin-top:12px;">You can revisit the material at any time from your dashboard.</p>`;
  return {
    subject: `Congratulations on completing ${mail.courseTitle}`,
    html: layout({
      heading: 'Course completed 🎉',
      bodyHtml: body,
      ctaLabel: mail.courseId ? 'Continue' : 'Go to my courses',
      ctaUrl,
    }),
    text: `Dear ${
      mail.firstName || 'there'
    },\n\nCongratulations on completing ${
      mail.courseTitle
    }! You have worked through all of the course content.\n\nContinue: ${ctaUrl}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}

/** Asks the user to provide feedback on a completed course. */
export function renderFeedbackRequest(
  mail: FeedbackRequestMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const ctaUrl = mail.courseId
    ? studentCourseFeedback(mail.courseId)
    : studentCoursesList();
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Now that you have completed <strong>${title}</strong>, we would value your feedback. It takes only a couple of minutes and helps us improve the course for future learners.</p>`;
  return {
    subject: `Share your feedback on ${mail.courseTitle}`,
    html: layout({
      heading: 'We would love your feedback',
      bodyHtml: body,
      ctaLabel: 'Give feedback',
      ctaUrl,
    }),
    text: `Dear ${mail.firstName || 'there'},\n\nNow that you have completed ${
      mail.courseTitle
    }, we would value your feedback. It takes only a couple of minutes.\n\nGive feedback: ${ctaUrl}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}

/** One-off backfill: completed 100% but feedback still outstanding. */
export function renderPendingFeedbackOutstanding(
  mail: PendingFeedbackOutstandingMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const ctaUrl = studentCourseFeedback(mail.courseId);
  const completedLine = mail.completedAt
    ? `<p style="margin-top:8px;color:${BRAND.muted};font-size:13px;">You completed this course on ${escapeHtml(mail.completedAt)}.</p>`
    : '';
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Our records show you have <strong>completed</strong> <strong>${title}</strong>, but we have not yet received your course feedback.</p>
    ${completedLine}
    <p style="margin-top:12px;">Your feedback helps us improve the learning experience for future students. It only takes a couple of minutes.</p>`;
  return {
    subject: `Feedback still needed for ${mail.courseTitle}`,
    html: layout({
      heading: 'We are missing your feedback',
      bodyHtml: body,
      ctaLabel: 'Complete feedback form',
      ctaUrl,
    }),
    text: `Dear ${mail.firstName || 'there'},\n\nOur records show you have completed ${mail.courseTitle}, but we have not yet received your course feedback.${
      mail.completedAt ? ` You completed on ${mail.completedAt}.` : ''
    }\n\nIt only takes a couple of minutes.\n\nComplete feedback: ${ctaUrl}\n\nKind regards,\nThe ${BRAND.name} Team`,
  };
}

/** Periodic nudge for learners who completed but have not submitted feedback. */
export function renderFeedbackReminder(
  mail: FeedbackRequestMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const ctaUrl = mail.courseId
    ? studentCourseFeedback(mail.courseId)
    : studentCoursesList();
  const body = `<p>Hi ${name},</p>
    <p style="margin-top:12px;">You finished <strong>${title}</strong> — would you mind sharing a few words about your experience? It takes about 2 minutes.</p>`;
  return {
    subject: `A quick favour about your recent course`,
    html: layout({
      heading: 'We would love your feedback',
      bodyHtml: body,
      ctaLabel: 'Give feedback',
      ctaUrl,
    }),
    text: `Hi ${mail.firstName || 'there'},\n\nYou finished ${
      mail.courseTitle
    } — would you mind sharing a few words about your experience? It takes about 2 minutes.\n\nGive feedback: ${ctaUrl}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}

/** Confirms to the user that their feedback was registered. */
export function renderFeedbackReceived(
  mail: FeedbackReceivedMail,
): RenderedEmail {
  const name = escapeHtml(mail.firstName || 'there');
  const title = escapeHtml(mail.courseTitle);
  const ctaUrl = mail.courseId
    ? studentCourseDetail(mail.courseId)
    : studentCoursesList();
  const body = `<p>Dear ${name},</p>
    <p style="margin-top:12px;">Thank you — your feedback for <strong>${title}</strong> has been registered. We appreciate you taking the time to help us improve.</p>`;
  return {
    subject: `Thank you for your feedback on ${mail.courseTitle}`,
    html: layout({
      heading: 'Feedback received',
      bodyHtml: body,
      ctaLabel: 'View your course',
      ctaUrl,
    }),
    text: `Dear ${
      mail.firstName || 'there'
    },\n\nThank you — your feedback for ${
      mail.courseTitle
    } has been registered.\n\nView your course: ${ctaUrl}\n\nKind regards,\nThe ${
      BRAND.name
    } Team`,
  };
}

/** Notifies the admin of a new feedback submission. */
export function renderFeedbackReceivedAdmin(
  mail: FeedbackReceivedAdminMail,
): RenderedEmail {
  const student = escapeHtml(mail.studentName || 'A student');
  const studentEmail = escapeHtml(mail.studentEmail);
  const title = escapeHtml(mail.courseTitle);
  const url = adminFeedback();
  const body = `<p>A new course feedback submission has been received.</p>
    <p style="margin-top:12px;"><strong>Student:</strong> ${student} (${studentEmail})</p>
    <p style="margin-top:4px;"><strong>Course:</strong> ${title}</p>
    <p style="margin-top:12px;">You can review it in the admin dashboard.</p>`;
  return {
    subject: `New feedback for ${mail.courseTitle}`,
    html: layout({
      heading: 'New course feedback',
      bodyHtml: body,
      ctaLabel: 'View feedback',
      ctaUrl: url,
    }),
    text: `New course feedback received.\n\nStudent: ${
      mail.studentName || 'A student'
    } (${mail.studentEmail})\nCourse: ${
      mail.courseTitle
    }\n\nView feedback: ${url}`,
  };
}
