/**
 * generate-email-previews.ts
 *
 * Renders every transactional email template with sample data and writes a
 * static preview gallery under docs/email-previews/ for client review.
 *
 *   yarn script:email-previews:generate
 *   yarn script:email-previews:serve   # opens at http://localhost:3456
 */

import * as fs from 'fs';
import * as path from 'path';
import { ReminderType } from '../src/mail/mail.types';
import { BRAND } from '../src/mail/templates/mail-layout';
import { renderWelcome } from '../src/mail/templates/welcome.template';
import { renderPasswordReset } from '../src/mail/templates/password-reset.template';
import { renderContactMessage } from '../src/mail/templates/contact-message.template';
import { renderEngagementReminder } from '../src/mail/templates/engagement-reminder.template';
import { renderNotificationEmail } from '../src/mail/templates/notification.template';
import {
  renderCourseCompleted,
  renderFeedbackRequest,
  renderFeedbackReminder,
  renderPendingFeedbackOutstanding,
  renderFeedbackReceived,
  renderFeedbackReceivedAdmin,
} from '../src/mail/templates/course-feedback.template';
import {
  studentCourseDetail,
  studentCourseFeedback,
} from '../src/mail/mail-paths';

const OUT_DIR = path.join(__dirname, '..', 'docs', 'email-previews');

const SAMPLE = {
  firstName: 'Alex',
  email: 'student@example.com',
  courseTitle:
    'NEBOSH International General Certificate in Occupational Health and Safety',
  courseId: '00000000-0000-4000-8000-000000000001',
  threadId: '00000000-0000-4000-8000-000000000002',
  attemptId: '00000000-0000-4000-8000-000000000003',
};

interface PreviewItem {
  id: string;
  category: string;
  name: string;
  subject: string;
  trigger: string;
  recipient: string;
  html: string;
}

function buildPreviews(): PreviewItem[] {
  const courseUrl = studentCourseDetail(SAMPLE.courseId);
  const feedbackUrl = studentCourseFeedback(SAMPLE.courseId);

  const items: Array<Omit<PreviewItem, 'html'> & { render: () => string }> = [
    {
      id: 'welcome',
      category: 'Auth',
      name: 'Welcome',
      subject: '',
      trigger: 'User self-registers',
      recipient: 'Student',
      render: () => renderWelcome({ to: SAMPLE.email, firstName: SAMPLE.firstName }).html,
    },
    {
      id: 'password-reset',
      category: 'Auth',
      name: 'Password reset',
      subject: '',
      trigger: 'Forgot-password OTP request',
      recipient: 'Student',
      render: () =>
        renderPasswordReset({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          otp: '482913',
          expiresInMinutes: 15,
        }).html,
    },
    {
      id: 'contact-message',
      category: 'Admin',
      name: 'Contact message',
      subject: '',
      trigger: 'Contact form submitted',
      recipient: 'Admin inbox',
      render: () =>
        renderContactMessage({
          to: 'admin@example.com',
          senderName: SAMPLE.firstName,
          senderEmail: SAMPLE.email,
          message:
            'I would like more information about course enrolment and certification timelines.',
        }).html,
    },
    {
      id: 'engagement-never-started',
      category: 'Engagement',
      name: 'Never started',
      subject: '',
      trigger: 'Engagement cron — enrolled, no activity',
      recipient: 'Student',
      render: () =>
        renderEngagementReminder({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          reminderType: ReminderType.NEVER_STARTED,
          courseUrl,
          courseDuration: '60 Days',
        }).html,
    },
    {
      id: 'engagement-stalled',
      category: 'Engagement',
      name: 'Stalled',
      subject: '',
      trigger: 'Engagement cron — inactive after progress',
      recipient: 'Student',
      render: () =>
        renderEngagementReminder({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          reminderType: ReminderType.STALLED,
          courseUrl,
          completedSections: 42,
          totalSections: 111,
        }).html,
    },
    {
      id: 'course-completed',
      category: 'Course lifecycle',
      name: 'Course completed',
      subject: '',
      trigger: 'First time 100% section progress',
      recipient: 'Student',
      render: () =>
        renderCourseCompleted({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          courseId: SAMPLE.courseId,
        }).html,
    },
    {
      id: 'feedback-request',
      category: 'Course lifecycle',
      name: 'Feedback request',
      subject: '',
      trigger: 'Sent with completion email when feedback form exists',
      recipient: 'Student',
      render: () =>
        renderFeedbackRequest({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          courseId: SAMPLE.courseId,
        }).html,
    },
    {
      id: 'feedback-reminder',
      category: 'Engagement',
      name: 'Feedback reminder',
      subject: '',
      trigger: 'Engagement cron — completed 2+ days, no feedback',
      recipient: 'Student',
      render: () =>
        renderFeedbackReminder({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          courseId: SAMPLE.courseId,
        }).html,
    },
    {
      id: 'feedback-outstanding',
      category: 'Course lifecycle',
      name: 'Feedback outstanding',
      subject: '',
      trigger: 'Manual backfill script',
      recipient: 'Student',
      render: () =>
        renderPendingFeedbackOutstanding({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          courseId: SAMPLE.courseId,
          completedAt: '2026-06-08',
        }).html,
    },
    {
      id: 'feedback-received',
      category: 'Feedback',
      name: 'Feedback received (student)',
      subject: '',
      trigger: 'Feedback form submitted',
      recipient: 'Student',
      render: () =>
        renderFeedbackReceived({
          to: SAMPLE.email,
          firstName: SAMPLE.firstName,
          courseTitle: SAMPLE.courseTitle,
          courseId: SAMPLE.courseId,
        }).html,
    },
    {
      id: 'feedback-received-admin',
      category: 'Feedback',
      name: 'Feedback received (admin)',
      subject: '',
      trigger: 'Feedback form submitted',
      recipient: 'Admin inbox',
      render: () =>
        renderFeedbackReceivedAdmin({
          to: 'admin@example.com',
          studentName: SAMPLE.firstName,
          studentEmail: SAMPLE.email,
          courseTitle: SAMPLE.courseTitle,
        }).html,
    },
    {
      id: 'notification-forum-thread',
      category: 'Notifications',
      name: 'Forum — new thread',
      subject: '',
      trigger: 'New forum thread notification',
      recipient: 'Student',
      render: () =>
        renderNotificationEmail({
          kind: 'FORUM_THREAD',
          to: SAMPLE.email,
          recipientFirstName: SAMPLE.firstName,
          threadId: SAMPLE.threadId,
          threadTitle: 'Best practices for risk assessment',
          creatorName: 'Jordan Lee',
        }).html,
    },
    {
      id: 'notification-forum-comment',
      category: 'Notifications',
      name: 'Forum — new reply',
      subject: '',
      trigger: 'New forum comment notification',
      recipient: 'Student',
      render: () =>
        renderNotificationEmail({
          kind: 'FORUM_COMMENT',
          to: SAMPLE.email,
          recipientFirstName: SAMPLE.firstName,
          threadId: SAMPLE.threadId,
          threadTitle: 'Best practices for risk assessment',
          commenterName: 'Samira Khan',
          excerpt: 'Great point — I also recommend documenting near-misses.',
        }).html,
    },
    {
      id: 'notification-assessment-submitted',
      category: 'Notifications',
      name: 'Assessment submitted',
      subject: '',
      trigger: 'Student submits assessment',
      recipient: 'Admin / grader',
      render: () =>
        renderNotificationEmail({
          kind: 'ASSESSMENT_SUBMITTED',
          to: 'admin@example.com',
          recipientFirstName: 'Admin',
          studentName: SAMPLE.firstName,
          assessmentTitle: 'Unit IG1 — Open book assessment',
          attemptId: SAMPLE.attemptId,
        }).html,
    },
    {
      id: 'notification-assessment-graded',
      category: 'Notifications',
      name: 'Assessment graded',
      subject: '',
      trigger: 'Assessment graded by admin',
      recipient: 'Student',
      render: () =>
        renderNotificationEmail({
          kind: 'ASSESSMENT_GRADED',
          to: SAMPLE.email,
          recipientFirstName: SAMPLE.firstName,
          assessmentTitle: 'Unit IG1 — Open book assessment',
          courseId: SAMPLE.courseId,
          passed: true,
          scorePct: 87,
        }).html,
    },
  ];

  return items.map((item) => {
    const rendered = item.render();
    // Pull subject from a second render path — each template function returns subject
    const subject = getSubjectForId(item.id);
    return {
      id: item.id,
      category: item.category,
      name: item.name,
      subject,
      trigger: item.trigger,
      recipient: item.recipient,
      html: rendered,
    };
  });
}

function getSubjectForId(id: string): string {
  const courseUrl = studentCourseDetail(SAMPLE.courseId);
  const map: Record<string, string> = {
    welcome: renderWelcome({ to: SAMPLE.email, firstName: SAMPLE.firstName }).subject,
    'password-reset': renderPasswordReset({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      otp: '482913',
      expiresInMinutes: 15,
    }).subject,
    'contact-message': renderContactMessage({
      to: 'admin@example.com',
      senderName: SAMPLE.firstName,
      senderEmail: SAMPLE.email,
      message: 'Sample',
    }).subject,
    'engagement-never-started': renderEngagementReminder({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      reminderType: ReminderType.NEVER_STARTED,
      courseUrl,
    }).subject,
    'engagement-stalled': renderEngagementReminder({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      reminderType: ReminderType.STALLED,
      courseUrl,
      completedSections: 42,
      totalSections: 111,
    }).subject,
    'course-completed': renderCourseCompleted({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      courseId: SAMPLE.courseId,
    }).subject,
    'feedback-request': renderFeedbackRequest({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      courseId: SAMPLE.courseId,
    }).subject,
    'feedback-reminder': renderFeedbackReminder({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      courseId: SAMPLE.courseId,
    }).subject,
    'feedback-outstanding': renderPendingFeedbackOutstanding({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      courseId: SAMPLE.courseId,
      completedAt: '2026-06-08',
    }).subject,
    'feedback-received': renderFeedbackReceived({
      to: SAMPLE.email,
      firstName: SAMPLE.firstName,
      courseTitle: SAMPLE.courseTitle,
      courseId: SAMPLE.courseId,
    }).subject,
    'feedback-received-admin': renderFeedbackReceivedAdmin({
      to: 'admin@example.com',
      studentName: SAMPLE.firstName,
      studentEmail: SAMPLE.email,
      courseTitle: SAMPLE.courseTitle,
    }).subject,
    'notification-forum-thread': renderNotificationEmail({
      kind: 'FORUM_THREAD',
      to: SAMPLE.email,
      recipientFirstName: SAMPLE.firstName,
      threadId: SAMPLE.threadId,
      threadTitle: 'Best practices for risk assessment',
      creatorName: 'Jordan Lee',
    }).subject,
    'notification-forum-comment': renderNotificationEmail({
      kind: 'FORUM_COMMENT',
      to: SAMPLE.email,
      recipientFirstName: SAMPLE.firstName,
      threadId: SAMPLE.threadId,
      threadTitle: 'Best practices for risk assessment',
      commenterName: 'Samira Khan',
      excerpt: 'Great point.',
    }).subject,
    'notification-assessment-submitted': renderNotificationEmail({
      kind: 'ASSESSMENT_SUBMITTED',
      to: 'admin@example.com',
      recipientFirstName: 'Admin',
      studentName: SAMPLE.firstName,
      assessmentTitle: 'Unit IG1 — Open book assessment',
      attemptId: SAMPLE.attemptId,
    }).subject,
    'notification-assessment-graded': renderNotificationEmail({
      kind: 'ASSESSMENT_GRADED',
      to: SAMPLE.email,
      recipientFirstName: SAMPLE.firstName,
      assessmentTitle: 'Unit IG1 — Open book assessment',
      courseId: SAMPLE.courseId,
      passed: true,
      scorePct: 87,
    }).subject,
  };
  return map[id] ?? '';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function buildGalleryIndex(previews: PreviewItem[]): string {
  const nav = previews
    .map(
      (p) =>
        `<a class="nav-item" href="#${p.id}" data-id="${p.id}" data-subject="${escapeAttr(p.subject)}" data-trigger="${escapeAttr(p.trigger)}" data-recipient="${escapeAttr(p.recipient)}">${escapeAttr(p.name)}<span class="nav-cat">${escapeAttr(p.category)}</span></a>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeAttr(BRAND.name)} — Email previews</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: #eef0f3; color: #1f2933; }
    .top { background: #344e41; color: #fff; padding: 20px 28px; }
    .top h1 { margin: 0 0 6px; font-size: 22px; }
    .top p { margin: 0; opacity: 0.9; font-size: 14px; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 88px); }
    .sidebar { background: #fff; border-right: 1px solid #e4e4e7; overflow-y: auto; padding: 12px; }
    .nav-item { display: block; padding: 10px 12px; margin-bottom: 4px; border-radius: 8px; text-decoration: none; color: #1f2933; font-size: 14px; font-weight: 500; }
    .nav-item:hover, .nav-item.active { background: #f0f4f1; color: #344e41; }
    .nav-cat { display: block; font-size: 11px; font-weight: 400; color: #71717a; margin-top: 2px; }
    .main { padding: 20px 24px 32px; overflow: auto; }
    .meta { background: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; border: 1px solid #e4e4e7; }
    .meta h2 { margin: 0 0 8px; font-size: 18px; }
    .meta dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 13px; }
    .meta dt { color: #71717a; }
    .meta dd { margin: 0; }
    .frame-wrap { background: #fff; border-radius: 12px; border: 1px solid #e4e4e7; overflow: hidden; }
    iframe { width: 100%; min-height: 720px; border: 0; display: block; background: #f4f5f7; }
    .direct { margin-top: 12px; font-size: 13px; }
    .direct a { color: #344e41; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid #e4e4e7; max-height: 220px; }
    }
  </style>
</head>
<body>
  <header class="top">
    <h1>${escapeAttr(BRAND.name)} — Email template previews</h1>
    <p>Sample data for client review. ${previews.length} templates.</p>
  </header>
  <div class="layout">
    <nav class="sidebar">${nav}</nav>
    <main class="main">
      <div class="meta">
        <h2 id="title">Select a template</h2>
        <dl>
          <dt>Subject</dt><dd id="subject">—</dd>
          <dt>Trigger</dt><dd id="trigger">—</dd>
          <dt>Recipient</dt><dd id="recipient">—</dd>
        </dl>
        <p class="direct">Direct link: <a id="direct-link" href="#">—</a></p>
      </div>
      <div class="frame-wrap">
        <iframe id="preview" title="Email preview" src="about:blank"></iframe>
      </div>
    </main>
  </div>
  <script>
    const links = document.querySelectorAll('.nav-item');
    const iframe = document.getElementById('preview');
    const title = document.getElementById('title');
    const subject = document.getElementById('subject');
    const trigger = document.getElementById('trigger');
    const recipient = document.getElementById('recipient');
    const direct = document.getElementById('direct-link');

    function show(id) {
      const link = document.querySelector('.nav-item[data-id="' + id + '"]');
      if (!link) return;
      links.forEach((el) => el.classList.remove('active'));
      link.classList.add('active');
      title.textContent = link.textContent.split(link.querySelector('.nav-cat').textContent)[0].trim();
      subject.textContent = link.dataset.subject;
      trigger.textContent = link.dataset.trigger;
      recipient.textContent = link.dataset.recipient;
      const file = id + '.html';
      iframe.src = file;
      direct.href = file;
      direct.textContent = new URL(file, window.location.href).href;
      history.replaceState(null, '', '#' + id);
    }

    links.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        show(link.dataset.id);
      });
    });

    const initial = (location.hash || '#${previews[0]?.id ?? 'welcome'}').slice(1);
    show(initial);
  </script>
</body>
</html>`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const previews = buildPreviews();

  for (const p of previews) {
    fs.writeFileSync(path.join(OUT_DIR, `${p.id}.html`), p.html, 'utf8');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildGalleryIndex(previews), 'utf8');

  console.log(`\n✅ Generated ${previews.length} email previews in docs/email-previews/\n`);
  console.log('   Open locally:  yarn script:email-previews:serve');
  console.log('   Then visit:    http://localhost:3456\n');
}

main();
