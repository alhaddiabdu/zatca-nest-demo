import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import zatcaConfig from './zatca.config';
import { ZatcaApiService, ZatcaResponse } from './api/zatca-api.service';
import { Credentials, EgsState, EgsStoreService, PendingInvoice } from './storage/egs-store.service';
import { createSelfSignedCert, generateKeyAndCsr } from './crypto/csr';
import { pemToCertBase64, tokenToCertBase64 } from './crypto/certificate';
import { signInvoice } from './crypto/signer';
import { buildInvoiceXml, riyadhDateTime } from './xml/invoice-builder';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

/**
 * دورة حياة كل فاتورة (الخطوات 6 إلى 11).
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(zatcaConfig.KEY) private readonly config: ConfigType<typeof zatcaConfig>,
    private readonly api: ZatcaApiService,
    private readonly store: EgsStoreService,
  ) {}

  async issue(dto: CreateInvoiceDto, dryRun = false) {
    return this.store.runExclusive(async () => {
      const state = this.store.load();
      const signer = dryRun ? this.localSigner(state) : this.productionSigner(state);

      // 6) بناء XML برقم العداد التالي وتجزئة الفاتورة السابقة
      const icv = state.chain.icv + 1;
      const pih = state.chain.pih;
      const uuid = randomUUID();
      const { date, time } = riyadhDateTime();
      let built;
      try {
        built = buildInvoiceXml(
          { ...dto, kind: dto.kind ?? 'invoice', uuid, issueDate: date, issueTime: time, icv, pih },
          this.config.seller,
        );
      } catch (e: any) {
        throw new BadRequestException(e.message);
      }

      // 7+8+9) التجزئة + التوقيع + QR
      const signed = signInvoice({
        unsignedXml: built.unsignedXml,
        privateKeyPem: signer.privateKeyPem,
        certBase64: signer.certBase64,
        qrFields: built.qrFields,
      });
      const qrImage = await QRCode.toDataURL(signed.qr);

      if (dryRun) {
        const xmlPath = this.store.saveInvoiceXml(`dryrun-${dto.id}`, signed.signedXml);
        return {
          dryRun: true,
          note: 'لم تُرسل للهيئة ولم تتغير السلسلة. التوقيع بشهادة محلية للتجربة فقط.',
          icv, pih, uuid, invoiceHash: signed.invoiceHash, totals: built.totals, qr: signed.qr, qrImage, xmlPath,
        };
      }

      // 11) الفاتورة صدرت من الوحدة، فتدخل السلسلة الآن
      state.chain = { icv, pih: signed.invoiceHash };
      this.store.save(state);

      // 10) الإرسال
      const body = {
        invoiceHash: signed.invoiceHash,
        uuid,
        invoice: Buffer.from(signed.signedXml, 'utf8').toString('base64'),
      };
      let res: ZatcaResponse;
      try {
        res = await this.submit(dto.category, signer.creds, body);
      } catch (err: any) {
        // انقطاع الاتصال: نحفظها لإعادة المحاولة (المبسطة يجب أن تصل خلال 24 ساعة)
        this.addPending(state, {
          id: dto.id, uuid, category: dto.category, invoiceHash: signed.invoiceHash,
          xmlBase64: body.invoice, createdAt: new Date().toISOString(), lastError: String(err?.message ?? err),
        });
        const xmlPath = this.store.saveInvoiceXml(dto.id, signed.signedXml);
        return { status: 'PENDING', message: 'تعذر الاتصال بالهيئة، حُفظت للإرسال لاحقاً', icv, uuid, xmlPath, qrImage };
      }

      // في الاعتماد تعيد الهيئة الفاتورة مختومة، وهي النسخة التي تُسلَّم للعميل
      const finalXml =
        res.body?.clearedInvoice ? Buffer.from(res.body.clearedInvoice, 'base64').toString('utf8') : signed.signedXml;
      const xmlPath = this.store.saveInvoiceXml(dto.id, finalXml);

      return {
        status: res.ok ? (res.status === 202 ? 'ACCEPTED_WITH_WARNINGS' : 'ACCEPTED') : 'REJECTED',
        httpStatus: res.status,
        icv, uuid, invoiceHash: signed.invoiceHash, totals: built.totals,
        zatca: res.body, xmlPath,
        qrImage: res.body?.clearedInvoice ? undefined : qrImage,
      };
    });
  }

  /** إعادة إرسال الفواتير المعلقة بسبب انقطاع الاتصال */
  async retryPending() {
    return this.store.runExclusive(async () => {
      const state = this.store.load();
      const signer = this.productionSigner(state);
      const remaining: PendingInvoice[] = [];
      const results: unknown[] = [];
      for (const p of state.pending ?? []) {
        try {
          const res = await this.submit(p.category, signer.creds, {
            invoiceHash: p.invoiceHash, uuid: p.uuid, invoice: p.xmlBase64,
          });
          results.push({ id: p.id, httpStatus: res.status, zatca: res.body });
        } catch (err: any) {
          remaining.push({ ...p, lastError: String(err?.message ?? err) });
        }
      }
      state.pending = remaining;
      this.store.save(state);
      return { sent: results, stillPending: remaining.length };
    });
  }

  private async submit(category: 'standard' | 'simplified', creds: Credentials, body: any) {
    if (category === 'simplified') return this.api.report(this.config.env, creds, body);
    const res = await this.api.clear(this.config.env, creds, body);
    // 303 = الاعتماد معطّل مؤقتاً من الهيئة، فتُرسل القياسية عبر الإبلاغ
    if (res.status === 303) return this.api.report(this.config.env, creds, body);
    return res;
  }

  private addPending(state: EgsState, p: PendingInvoice) {
    state.pending = [...(state.pending ?? []), p];
    this.store.save(state);
  }

  private productionSigner(state: EgsState) {
    if (!state.production || !state.privateKeyPem) {
      throw new BadRequestException('الوحدة غير مسجلة. نفّذ POST /zatca/onboard أولاً، أو استخدم ?dryRun=true للتجربة.');
    }
    return {
      creds: state.production,
      privateKeyPem: state.privateKeyPem,
      certBase64: tokenToCertBase64(state.production.binarySecurityToken),
    };
  }

  private localSigner(state: EgsState) {
    if (!state.localTest) {
      const { privateKeyPem } = generateKeyAndCsr({
        commonName: 'local-test', orgUnit: 'test', orgName: 'test', vatNumber: this.config.seller.vatNumber,
        solutionName: 'test', model: 'test', serial: 'test', invoiceType: '1100', location: 'test',
        industry: 'test', certTemplateName: this.config.certTemplateName,
      });
      state.localTest = { privateKeyPem, certPem: createSelfSignedCert(privateKeyPem) };
      this.store.save(state);
      this.logger.log('تم إنشاء شهادة محلية للتجربة (dryRun)');
    }
    return {
      creds: null as unknown as Credentials,
      privateKeyPem: state.localTest.privateKeyPem,
      certBase64: pemToCertBase64(state.localTest.certPem),
    };
  }
}
