import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { EnvironmentEntity, ZatcaEnvName } from '../../database/entities/environment.entity';
import { InvoiceEntity } from '../../database/entities/invoice.entity';

/** ما تحتاجه دالة البناء والتوقيع من السلسلة */
export interface ChainContext {
  chainEpoch: number;
  icv: number;
  pih: string;
}

/** ناتج البناء والتوقيع: كل حقول الفاتورة عدا ما يحدده ChainService */
export type ChainBuildResult = Pick<
  InvoiceEntity,
  'uuid' | 'category' | 'kind' | 'invoiceHash' | 'issueDate' | 'issueTime' | 'lines' | 'signedXml' | 'qr'
> &
  Partial<
    Pick<
      InvoiceEntity,
      'buyer' | 'paymentMeansCode' | 'originalInvoiceId' | 'reason' | 'netAmount' | 'vatAmount' | 'totalAmount'
    >
  >;

/** أول إعادة محاولة بعد 5 دقائق، حتى لا يلتقط المُجدوِل الفاتورة أثناء إرسالها الأول */
export const FIRST_RETRY_DELAY_MS = 5 * 60_000;

/**
 * حجز رقم العداد ICV وتجزئة الفاتورة السابقة PIH وإدخال الفاتورة في transaction واحدة.
 *
 * SELECT ... FOR UPDATE على صف الوضع يجعل الإصدارات المتزامنة (حتى من أكثر من نسخة من التطبيق)
 * تنتظر بعضها، فلا يتكرر ICV ولا ينكسر تسلسل PIH. أي خطأ يلغي كل شيء.
 * الإرسال للهيئة يتم بعد الـ COMMIT وخارج القفل.
 */
@Injectable()
export class ChainService {
  constructor(private readonly dataSource: DataSource) {}

  async issueInChain(
    env: ZatcaEnvName,
    invoiceNumber: string,
    build: (ctx: ChainContext) => ChainBuildResult | Promise<ChainBuildResult>,
  ): Promise<InvoiceEntity> {
    try {
      return await this.dataSource.transaction(async (m) => {
        const envRepo = m.getRepository(EnvironmentEntity);
        const invoiceRepo = m.getRepository(InvoiceEntity);

        const row = await envRepo.findOne({ where: { env }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException({ code: 'UNKNOWN_MODE', message: `وضع غير معروف: ${env}` });

        if (await invoiceRepo.exists({ where: { env, invoiceNumber, isDryRun: false } })) {
          throw this.duplicate(invoiceNumber);
        }

        const ctx: ChainContext = { chainEpoch: row.chainEpoch, icv: row.icv + 1, pih: row.pih };
        const built = await build(ctx);

        const saved = await invoiceRepo.save(
          invoiceRepo.create({
            ...built,
            env,
            invoiceNumber,
            isDryRun: false,
            chainEpoch: ctx.chainEpoch,
            icv: ctx.icv,
            pih: ctx.pih,
            status: 'PENDING',
            attempts: 0,
            nextRetryAt: new Date(Date.now() + FIRST_RETRY_DELAY_MS),
          }),
        );
        await envRepo.update({ env }, { icv: ctx.icv, pih: built.invoiceHash });
        return saved;
      });
    } catch (err) {
      // سباق نادر بين فحص التكرار والإدخال: القيد الفريد في القاعدة هو الحَكَم الأخير
      const constraint = (err as QueryFailedError & { driverError?: { constraint?: string } }).driverError?.constraint;
      if (err instanceof QueryFailedError && constraint === 'invoices_env_number_uq') throw this.duplicate(invoiceNumber);
      throw err;
    }
  }

  private duplicate(invoiceNumber: string) {
    return new ConflictException({
      code: 'DUPLICATE_INVOICE_NUMBER',
      message: `رقم الفاتورة ${invoiceNumber} مستخدم مسبقاً في هذا الوضع`,
    });
  }
}
