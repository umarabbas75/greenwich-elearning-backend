import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  EngagementReminderMail,
  MailSendResult,
  PasswordResetMail,
} from './mail.types';
import { renderEngagementReminder } from './templates/engagement-reminder.template';
import { renderPasswordReset } from './templates/password-reset.template';
import { RenderedEmail } from './templates/mail-layout';

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

  constructor(private readonly config: ConfigService) {
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
    );
  }

  /**
   * Sends the password-reset OTP email. Like all sends it returns a result
   * rather than throwing — but the caller (PasswordResetService) treats a
   * failed send as an error, since here email is the only delivery channel.
   */
  async sendPasswordReset(mail: PasswordResetMail): Promise<MailSendResult> {
    return this.send(mail.to, renderPasswordReset(mail), 'password reset');
  }

  /** Shared send path. Best-effort: resolves to a result, never throws. */
  private async send(
    to: string,
    rendered: RenderedEmail,
    label: string,
  ): Promise<MailSendResult> {
    if (!this.client) {
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
        return { sent: false, reason: error.message };
      }
      return { sent: true, id: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send ${label} to ${to}: ${message}`);
      return { sent: false, reason: message };
    }
  }
}
