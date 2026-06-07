import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EngagementReminderMail, MailSendResult } from './mail.types';
import { renderEngagementReminder } from './templates/engagement-reminder.template';

const DEFAULT_FROM =
  'Greenwich Training Centre <noreply@greenwichtc-elearning.com>';

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
    if (!this.client) {
      return { sent: false, reason: 'mail-disabled' };
    }

    const { subject, html, text } = renderEngagementReminder(mail);

    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to: mail.to,
        subject,
        html,
        text,
      });

      if (error) {
        this.logger.error(
          `Resend rejected engagement reminder to ${mail.to}: ${error.name} — ${error.message}`,
        );
        return { sent: false, reason: error.message };
      }

      return { sent: true, id: data?.id };
    } catch (err) {
      // Network / SDK failure — swallow so the sweep continues. Email is best-effort.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to send engagement reminder to ${mail.to}: ${message}`,
      );
      return { sent: false, reason: message };
    }
  }
}
