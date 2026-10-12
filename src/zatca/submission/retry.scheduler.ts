import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ZATCA_ENVS } from '../environments/environments.service';
import { RetryService } from './retry.service';

export const RETRY_INTERVAL_MS = 5 * 60_000;

/**
 * كل 5 دقائق: إعادة إرسال المعلّق المستحق (next_retry_at <= now) في كل الأوضاع.
 * التأخير التصاعدي يحدده next_retry_at (classify.ts). إذا طالت دورة لا تبدأ أخرى فوقها.
 * يُعطّل بـ RETRY_SCHEDULER_ENABLED=false (في الاختبارات).
 */
@Injectable()
export class RetryScheduler {
  private readonly logger = new Logger(RetryScheduler.name);
  private running = false;

  constructor(
    private readonly retry: RetryService,
    private readonly config: ConfigService,
  ) {}

  @Interval('zatca-retry', RETRY_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.config.get<string>('RETRY_SCHEDULER_ENABLED') === 'false') return;
    if (this.running) {
      this.logger.warn('الدورة السابقة لإعادة الإرسال ما زالت تعمل، تخطّي هذه الدورة');
      return;
    }
    this.running = true;
    try {
      for (const env of ZATCA_ENVS) {
        try {
          await this.retry.retryDue(env);
        } catch (err) {
          this.logger.error(`فشلت إعادة الإرسال في ${env}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
