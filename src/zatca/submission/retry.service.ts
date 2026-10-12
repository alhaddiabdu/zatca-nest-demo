import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ZatcaEnvName } from '../../database/entities/environment.entity';
import { InvoiceEntity, InvoiceStatus } from '../../database/entities/invoice.entity';
import { ZatcaApi } from '../api/zatca-api.port';
import { EnvironmentsService } from '../environments/environments.service';
import { outcomeFields, submitInvoice } from './submit';

export interface RetrySummary {
  attempted: number;
  accepted: number;
  rejected: number;
  stillPending: number;
  results: Array<{ id: string; invoiceNumber: string; status: InvoiceStatus; httpStatus: number | null; lastError: string | null }>;
}

/**
 * إعادة إرسال الفواتير المعلّقة (PENDING) من الجدول.
 *
 * كل فاتورة في transaction خاصة بها: SELECT ... FOR UPDATE SKIP LOCKED ثم الإرسال ثم التحديث.
 * القفل يبقى أثناء الإرسال، فاستدعاءان متوازيان (يدوي + مُجدوِل، أو نسختان من التطبيق) لا يرسلان
 * نفس الفاتورة مرتين. تُرسل signed_xml المحفوظة كما هي. المرفوضة تبقى في الجدول بحالة REJECTED.
 */
@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly api: ZatcaApi,
    private readonly environments: EnvironmentsService,
  ) {}

  /**
   * @param env وضع واحد، أو كل الأوضاع إن لم يُحدد
   * @param opts.force تجاهل next_retry_at (للإعادة اليدوية)
   */
  async retryDue(env?: ZatcaEnvName, opts: { force?: boolean; limit?: number } = {}): Promise<RetrySummary> {
    const limit = opts.limit ?? 20;
    const processed: string[] = [];
    const summary: RetrySummary = { attempted: 0, accepted: 0, rejected: 0, stillPending: 0, results: [] };

    while (processed.length < limit) {
      const found = await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(InvoiceEntity);
        const qb = repo
          .createQueryBuilder('i')
          .where(`i.status = 'PENDING'`)
          .andWhere('NOT i.is_dry_run');
        if (env) qb.andWhere('i.env = :env', { env });
        if (!opts.force) qb.andWhere('i.next_retry_at <= now()');
        if (processed.length) qb.andWhere('i.id NOT IN (:...processed)', { processed });
        const invoice = await qb
          .orderBy('i.next_retry_at', 'ASC', 'NULLS FIRST')
          .limit(1)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();
        if (!invoice) return false;
        processed.push(invoice.id);

        const creds = (await this.environments.getSecrets(invoice.env)).production;
        if (!creds) {
          await repo.update({ id: invoice.id }, { lastError: 'الوضع غير مسجّل لدى الهيئة، لا يمكن الإرسال' });
          summary.stillPending++;
          return true;
        }

        const submitted = await submitInvoice(this.api, invoice.env, invoice.category, creds, {
          invoiceHash: invoice.invoiceHash,
          uuid: invoice.uuid,
          invoice: Buffer.from(invoice.signedXml, 'utf8').toString('base64'),
        });
        const fields = outcomeFields(submitted, invoice.attempts + 1);
        await repo.update({ id: invoice.id }, fields as QueryDeepPartialEntity<InvoiceEntity>);

        summary.attempted++;
        if (fields.status === 'REJECTED') summary.rejected++;
        else if (fields.status === 'PENDING') summary.stillPending++;
        else summary.accepted++;
        summary.results.push({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: fields.status!,
          httpStatus: fields.httpStatus ?? null,
          lastError: fields.lastError ?? null,
        });
        return true;
      });
      if (!found) break;
    }

    if (summary.attempted) {
      this.logger.log(
        `إعادة الإرسال${env ? ` [${env}]` : ''}: ${summary.attempted} محاولة، ${summary.accepted} مقبولة، ` +
          `${summary.rejected} مرفوضة، ${summary.stillPending} ما زالت معلّقة`,
      );
    }
    return summary;
  }
}
