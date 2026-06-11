import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailType, Prisma } from '@prisma/client';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContactMessageMail,
  CourseCompletedMail,
  EngagementReminderMail,
  FeedbackReceivedAdminMail,
  FeedbackReceivedMail,
  FeedbackRequestMail,
  MailSendResult,
  NotificationEmail,
  PasswordResetMail,
  WelcomeMail,
} from './mail.types';
import { renderEngagementReminder } from './templates/engagement-reminder.template';
import { renderPasswordReset } from './templates/password-reset.template';
import { renderNotificationEmail } from './templates/notification.template';
import { renderWelcome } from './templates/welcome.template';
import { renderContactMessage } from './templates/contact-message.template';
import {
  renderCourseCompleted,
  renderFeedbackReceived,
  renderFeedbackReceivedAdmin,
  renderFeedbackRequest,
  renderFeedbackReminder,
} from './templates/course-feedback.template';
import { RenderedEmail } from './templates/mail-layout';

/** Maps a notification email kind → the EmailLog EmailType for auditing. */
const NOTIFICATION_EMAIL_TYPE: Record<NotificationEmail['kind'], EmailType> = {
  FORUM_THREAD: EmailType.NOTIFICATION_FORUM_THREAD,
  FORUM_COMMENT: EmailType.NOTIFICATION_FORUM_COMMENT,
  ASSESSMENT_SUBMITTED: EmailType.NOTIFICATION_ASSESSMENT_SUBMITTED,
  ASSESSMENT_GRADED: EmailType.NOTIFICATION_ASSESSMENT_GRADED,
};

/** Audit context recorded to EmailLog alongside each send. */
interface SendAudit {
  type: EmailType;
  userId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

const DEFAULT_FROM =
  'Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>';

/**
 * Transactional email transport, wrapping Resend behind a narrow interface so
 * the provider can be swapped without touching callers. All public methods are
 * best-effort: they resolve to a {@link MailSendResult} and never throw, so a
 * failed send can never break the engagement sweep (the in-app notification is
 * the source of truth — email is a secondary channel).
 *
 * When RESEND_API_KEY is unset (local/dev/test) the service no-ops and logs,
 * keeping the rest of the pipeline runnable without sending real mail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('MAIL_FROM') ?? DEFAULT_FROM;
    this.client = apiKey ? new Resend(apiKey) : null;
    if (!this.client) {
      this.logger.warn(
        'RESEND_API_KEY is not set — MailService will no-op (emails are skipped).',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async sendEngagementReminder(
    mail: EngagementReminderMail,
  ): Promise<MailSendResult> {
    return this.send(
      mail.to,
      renderEngagementReminder(mail),
      'engagement reminder',
      {
        type: EmailType.ENGAGEMENT_REMINDER,
        userId: mail.userId ?? null,
        metadata: {
          reminderType: mail.reminderType,
          courseTitle: mail.courseTitle,
        },
      },
    );
  }

  /**
   * Sends the password-reset OTP email. Like all sends it returns a result
   * rather than throwing — but the caller (PasswordResetService) treats a
   * failed send as an error, since here email is the only delivery channel.
   */
  async sendPasswordReset(mail: PasswordResetMail): Promise<MailSendResult> {
    return this.send(mail.to, renderPasswordReset(mail), 'password reset', {
      type: EmailType.PASSWORD_RESET,
      userId: mail.userId ?? null,
    });
  }

  /** Mirror of an in-app notification, sent to the notification's recipient. */
  async sendNotificationEmail(
    mail: NotificationEmail,
  ): Promise<MailSendResult> {
    return this.send(
      mail.to,
      renderNotificationEmail(mail),
      `notification:${mail.kind}`,
      { type: NOTIFICATION_EMAIL_TYPE[mail.kind], userId: mail.userId ?? null },
    );
  }

  /** Welcome email sent when a user self-registers. */
  async sendWelcome(mail: WelcomeMail): Promise<MailSendResult> {
    return this.send(mail.to, renderWelcome(mail), 'welcome', {
      type: EmailType.WELCOME,
      userId: mail.userId ?? null,
    });
  }

  /** "Contact us" message emailed to a single admin recipient. */
  async sendContactMessage(mail: ContactMessageMail): Promise<MailSendResult> {
    return this.send(mail.to, renderContactMessage(mail), 'contact message', {
      type: EmailType.CONTACT_MESSAGE,
      userId: mail.userId ?? null,
      metadata: { senderEmail: mail.senderEmail },
    });
  }

  /** Congratulations email on course completion. */
  async sendCourseCompleted(
    mail: CourseCompletedMail,
  ): Promise<MailSendResult> {
    return this.send(mail.to, renderCourseCompleted(mail), 'course completed', {
      type: EmailType.COURSE_COMPLETED,
      userId: mail.userId ?? null,
      metadata: { courseTitle: mail.courseTitle },
    });
  }

  /** Asks the user to provide course feedback (after completion). */
  async sendFeedbackRequest(
    mail: FeedbackRequestMail,
  ): Promise<MailSendResult> {
    return this.send(mail.to, renderFeedbackRequest(mail), 'feedback request', {
      type: EmailType.FEEDBACK_REQUEST,
      userId: mail.userId ?? null,
      metadata: { courseTitle: mail.courseTitle, courseId: mail.courseId },
    });
  }

  /** Periodic reminder for pending required course feedback. */
  async sendFeedbackReminder(
    mail: FeedbackRequestMail,
  ): Promise<MailSendResult> {
    return this.send(
      mail.to,
      renderFeedbackReminder(mail),
      'feedback reminder',
      {
        type: EmailType.FEEDBACK_REMINDER,
        userId: mail.userId ?? null,
        metadata: { courseTitle: mail.courseTitle, courseId: mail.courseId },
      },
    );
  }

  /** Confirms to the user that their feedback was registered. */
  async sendFeedbackReceived(
    mail: FeedbackReceivedMail,
  ): Promise<MailSendResult> {
    return this.send(
      mail.to,
      renderFeedbackReceived(mail),
      'feedback received',
      {
        type: EmailType.FEEDBACK_RECEIVED,
        userId: mail.userId ?? null,
        metadata: { courseTitle: mail.courseTitle },
      },
    );
  }

  /** Notifies the admin of a new feedback submission. */
  async sendFeedbackReceivedAdmin(
    mail: FeedbackReceivedAdminMail,
  ): Promise<MailSendResult> {
    return this.send(
      mail.to,
      renderFeedbackReceivedAdmin(mail),
      'feedback received (admin)',
      {
        type: EmailType.FEEDBACK_RECEIVED_ADMIN,
        userId: mail.userId ?? null,
        metadata: {
          courseTitle: mail.courseTitle,
          studentEmail: mail.studentEmail,
        },
      },
    );
  }

  /** Shared send path. Best-effort: resolves to a result, never throws. */
  private async send(
    to: string,
    rendered: RenderedEmail,
    label: string,
    audit: SendAudit,
  ): Promise<MailSendResult> {
    if (!this.client) {
      await this.recordEmailLog(to, audit, {
        status: 'SKIPPED',
        error: 'mail-disabled',
      });
      return { sent: false, reason: 'mail-disabled' };
    }
    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (error) {
        this.logger.error(
          `Resend rejected ${label} to ${to}: ${error.name} — ${error.message}`,
        );
        await this.recordEmailLog(to, audit, {
          status: 'FAILED',
          error: error.message,
        });
        return { sent: false, reason: error.message };
      }
      await this.recordEmailLog(to, audit, {
        status: 'SENT',
        providerId: data?.id,
      });
      return { sent: true, id: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send ${label} to ${to}: ${message}`);
      await this.recordEmailLog(to, audit, {
        status: 'FAILED',
        error: message,
      });
      return { sent: false, reason: message };
    }
  }

  /**
   * Persist an EmailLog row. Best-effort: a logging failure must never affect
   * the send result, so errors are swallowed (and logged) like LoginEvent.
   */
  private async recordEmailLog(
    recipient: string,
    audit: SendAudit,
    outcome: {
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      providerId?: string;
      error?: string;
    },
  ): Promise<void> {
    try {
      await this.prisma.emailLog.create({
        data: {
          recipient,
          type: audit.type,
          userId: audit.userId ?? null,
          metadata: audit.metadata,
          status: outcome.status,
          providerId: outcome.providerId ?? null,
          error: outcome.error ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to record EmailLog for ${recipient}: ${message}`,
      );
    }
  }
}
