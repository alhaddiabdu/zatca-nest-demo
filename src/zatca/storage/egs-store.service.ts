import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import zatcaConfig from '../zatca.config';
import { INITIAL_PIH } from '../crypto/signer';

export interface Credentials {
  binarySecurityToken: string;
  secret: string;
  requestId?: string;
}

export interface EgsState {
  privateKeyPem?: string;
  csrPem?: string;
  compliance?: Credentials;
  production?: Credentials;
  /** سلسلة الفواتير: آخر عداد وآخر تجزئة */
  chain: { icv: number; pih: string };
  onboardedAt?: string;
  /** فواتير لم تصل للهيئة بسبب انقطاع الاتصال، تُعاد محاولة إرسالها لاحقاً */
  pending?: PendingInvoice[];
  /** شهادة ذاتية التوقيع لتجربة dryRun بدون تسجيل */
  localTest?: { privateKeyPem: string; certPem: string };
}

export interface PendingInvoice {
  id: string;
  uuid: string;
  category: 'standard' | 'simplified';
  invoiceHash: string;
  xmlBase64: string;
  createdAt: string;
  lastError: string;
}

/**
 * تخزين حالة وحدة إصدار الفواتير في ملف JSON.
 * ⚠️ للتجربة فقط: في الإنتاج استخدم قاعدة بيانات مع معاملات (transactions)،
 * واحفظ المفتاح الخاص مشفراً أو في خزنة أسرار (Vault / KMS / HSM).
 */
@Injectable()
export class EgsStoreService {
  private readonly file: string;
  private readonly invoicesDir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@Inject(zatcaConfig.KEY) private readonly config: ConfigType<typeof zatcaConfig>) {
    mkdirSync(config.dataDir, { recursive: true });
    this.invoicesDir = join(config.dataDir, 'invoices');
    mkdirSync(this.invoicesDir, { recursive: true });
    this.file = join(config.dataDir, `egs-${config.env}.json`);
  }

  load(): EgsState {
    if (!existsSync(this.file)) return { chain: { icv: 0, pih: INITIAL_PIH } };
    return JSON.parse(readFileSync(this.file, 'utf8'));
  }

  save(state: EgsState): void {
    writeFileSync(this.file, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  saveInvoiceXml(name: string, xml: string): string {
    const path = this.invoicePath(name);
    writeFileSync(path, xml, 'utf8');
    return path;
  }

  /** يعيد XML فاتورة محفوظة، أو null إذا لم توجد */
  readInvoiceXml(name: string): string | null {
    const path = this.invoicePath(name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  private invoicePath(name: string): string {
    return join(this.invoicesDir, `${name.replace(/[^\w.-]/g, '_')}.xml`);
  }

  /**
   * ينفّذ العمليات واحدة تلو الأخرى، حتى لا تأخذ فاتورتان نفس العداد أو نفس PIH
   * إذا وصل طلبان في نفس اللحظة.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
