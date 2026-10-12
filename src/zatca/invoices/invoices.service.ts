import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { InvoiceEntity } from '../../database/entities/invoice.entity';
import { ModeService } from '../modes/mode.service';
import { InvoicesQueryDto } from './invoices-query.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** الأعمدة التي يعرضها الجدول (بدون الـ XML لأنه كبير) */
const SUMMARY_COLUMNS: (keyof InvoiceEntity)[] = [
  'id', 'env', 'invoiceNumber', 'isDryRun', 'category', 'kind', 'icv', 'status', 'totalAmount',
  'httpStatus', 'attempts', 'nextRetryAt', 'lastError', 'issueDate', 'issueTime', 'createdAt',
];

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(InvoiceEntity) private readonly invoices: Repository<InvoiceEntity>,
    private readonly modes: ModeService,
  ) {}

  async list(query: InvoicesQueryDto) {
    const env = query.env ?? (await this.modes.requireActive());
    const qb = this.invoices
      .createQueryBuilder('i')
      .select(SUMMARY_COLUMNS.map((c) => `i.${c}`))
      .where('i.env = :env', { env });

    if (query.status) qb.andWhere('i.status = :status', { status: query.status });
    if (!query.includeDryRun && query.status !== 'DRY_RUN') qb.andWhere('NOT i.is_dry_run');
    if (query.category) qb.andWhere('i.category = :category', { category: query.category });
    if (query.kind) qb.andWhere('i.kind = :kind', { kind: query.kind });
    if (query.q) {
      qb.andWhere('(i.invoice_number ILIKE :like OR i.uuid::text = :exact)', {
        like: `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
        exact: query.q.toLowerCase(),
      });
    }
    if (query.from) qb.andWhere('i.issue_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('i.issue_date <= :to', { to: query.to });

    const [items, total] = await qb
      .orderBy('i.created_at', 'DESC')
      .addOrderBy('i.icv', 'DESC', 'NULLS LAST')
      .addOrderBy('i.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return { env, items, total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string) {
    const invoice = await this.find(id);
    const { signedXml, clearedXml, ...rest } = invoice;
    return {
      ...rest,
      hasClearedXml: !!clearedXml,
      signedXmlLength: signedXml.length,
      qrImage: await QRCode.toDataURL(invoice.qr),
    };
  }

  /**
   * version: signed = الموقّعة منا، cleared = المختومة من الهيئة، وبدونه: المختومة إن وُجدت وإلا الموقّعة.
   * مؤقتاً حتى تحديث الواجهة: يقبل رقم الفاتورة بدل المعرّف (في الوضع النشط).
   */
  async xml(idOrNumber: string, version?: 'signed' | 'cleared', dryRun = false): Promise<string> {
    let invoice: InvoiceEntity | null;
    if (UUID.test(idOrNumber)) {
      invoice = await this.invoices.findOneBy({ id: idOrNumber });
    } else {
      const env = await this.modes.requireActive();
      invoice = await this.invoices.findOne({
        where: { env, invoiceNumber: idOrNumber, isDryRun: dryRun },
        order: { createdAt: 'DESC' },
      });
    }
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    if (version === 'cleared' && !invoice.clearedXml) throw new NotFoundException('لا توجد نسخة معتمدة من الهيئة لهذه الفاتورة');
    if (version === 'signed') return invoice.signedXml;
    return invoice.clearedXml ?? invoice.signedXml;
  }

  private async find(id: string): Promise<InvoiceEntity> {
    const invoice = await this.invoices.findOneBy({ id });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    return invoice;
  }
}
