import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { envProfile } from './zatca.config';
import { ZatcaApi } from './api/zatca-api.port';
import { Credentials, EgsStoreService, PendingInvoice } from './storage/egs-store.service';
import { createSelfSignedCert, generateKeyAndCsr } from './crypto/csr';
import { pemToCertBase64, tokenToCertBase64 } from './crypto/certificate';
import { signInvoice } from './crypto/signer';
import { buildInvoiceXml, riyadhDateTime } from './xml/invoice-builder';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { EnvironmentsService } from './environments/environments.service';
import { ModeService } from './modes/mode.service';
import { ChainService } from './chain/chain.service';
import { outcomeFields, submitInvoice } from './submission/submit';
import { ZatcaEnvName } from '../database/entities/environment.entity';
import { InvoiceEntity } from '../database/entities/invoice.entity';
import { SellerInfo } from './zatca.config';

/**
 * دورة حياة كل فاتورة (الخطوات 6 إلى 11) للوضع النشط.
 * كل فاتورة صف في جدول invoices، والسلسلة ICV/PIH تُحجز داخل transaction (ChainService).
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly api: ZatcaApi,
    private readonly store: EgsStoreService,
    private readonly environments: EnvironmentsService,
    private readonly modes: ModeService,
    private readonly chain: ChainService,
    @InjectRepository(InvoiceEntity) private readonly invoices: Repository<InvoiceEntity>,
  ) {}

  async issue(dto: CreateInvoiceDto, dryRun = false) {
    const env = await this.modes.requireActive();
    const row = await this.environments.get(env);
    const seller = this.environments.toSeller(row);
    const signer = dryRun ? await this.localSigner(env) : await this.productionSigner(env);
    const uuid = randomUUID();
    const { date, time } = riyadhDateTime();

    // 6+7+8+9) بناء XML ثم التجزئة والتوقيع و QR (الدوال المجمّدة كما هي)
    const buildAndSign = (icv: number, pih: string) => {
      let built;
      try {
        built = buildInvoiceXml(
          { ...dto, kind: dto.kind ?? 'invoice', uuid, issueDate: date, issueTime: time, icv, pih },
          seller as SellerInfo,
        );
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const signed = signInvoice({
        unsignedXml: built.unsignedXml,
        privateKeyPem: signer.privateKeyPem,
        certBase64: signer.certBase64,
        qrFields: built.qrFields,
      });
      const fields = {
        uuid,
        category: dto.category,
        kind: dto.kind ?? 'invoice',
        invoiceHash: signed.invoiceHash,
        issueDate: date,
        issueTime: time,
        buyer: (dto.buyer ?? null) as Record<string, unknown> | null,
        lines: dto.lines as unknown as Array<Record<string, unknown>>,
        paymentMeansCode: dto.paymentMeansCode ?? null,
        originalInvoiceId: dto.originalInvoiceId ?? null,
        reason: dto.reason ?? null,
        netAmount: built.totals.net,
        vatAmount: built.totals.vat,
        totalAmount: built.totals.total,
        signedXml: signed.signedXml,
        qr: signed.qr,
      };
      return { built, signed, fields };
    };

    if (dryRun) {
      // التجربة لا تدخل السلسلة: نعرض العداد التالي فقط
      const icv = row.icv + 1;
      const { built, signed, fields } = buildAndSign(icv, row.pih);
      const saved = await this.invoices.save(
        this.invoices.create({ ...fields, env, invoiceNumber: dto.id, isDryRun: true, status: 'DRY_RUN' }),
      );
      // مؤقتاً حتى الخطوة 23: نسخة على القرص لرابط XML في الواجهة الحالية
      const xmlPath = this.store.saveInvoiceXml(`dryrun-${dto.id}`, signed.signedXml);
      return {
        dryRun: true,
        note: 'لم تُرسل للهيئة ولم تتغير السلسلة. التوقيع بشهادة محلية للتجربة فقط.',
        invoiceId: saved.id,
        icv, pih: row.pih, uuid, invoiceHash: signed.invoiceHash, totals: built.totals, qr: signed.qr,
        qrImage: await QRCode.toDataURL(signed.qr),
        xmlPath,
      };
    }

    // 11) حجز ICV/PIH وإدخال الفاتورة PENDING في transaction واحدة
    let result!: ReturnType<typeof buildAndSign>;
    const invoice = await this.chain.issueInChain(env, dto.id, (ctx) => {
      result = buildAndSign(ctx.icv, ctx.pih);
      return result.fields;
    });

    // 10) الإرسال خارج القفل، ثم تحديث الصف حسب الرد
    const submitted = await submitInvoice(this.api, env, dto.category, signer.creds, {
      invoiceHash: invoice.invoiceHash,
      uuid,
      invoice: Buffer.from(invoice.signedXml, 'utf8').toString('base64'),
    });
    const fields = outcomeFields(submitted, 1);
    await this.invoices.update({ id: invoice.id }, fields as QueryDeepPartialEntity<InvoiceEntity>);

    const xmlPath = this.store.saveInvoiceXml(dto.id, fields.clearedXml ?? invoice.signedXml);
    return {
      invoiceId: invoice.id,
      status: fields.status,
      httpStatus: fields.httpStatus ?? undefined,
      message: fields.status === 'PENDING' ? 'تعذر الإرسال للهيئة، حُفظت وستُعاد المحاولة تلقائياً' : undefined,
      icv: invoice.icv, uuid, invoiceHash: invoice.invoiceHash, totals: result.built.totals,
      zatca: submitted.res?.body,
      xmlPath,
      qrImage: fields.clearedXml ? undefined : await QRCode.toDataURL(invoice.qr),
    };
  }

  /** إعادة إرسال الفواتير المعلقة بسبب انقطاع الاتصال */
  async retryPending() {
    return this.store.runExclusive(async () => {
      const state = this.store.load();
      const signer = await this.productionSigner(await this.modes.requireActive());
      const remaining: PendingInvoice[] = [];
      const results: unknown[] = [];
      for (const p of state.pending ?? []) {
        try {
          const res = await this.submit(signer.env, p.category, signer.creds, {
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

  private async submit(env: ZatcaEnvName, category: 'standard' | 'simplified', creds: Credentials, body: any) {
    if (category === 'simplified') return this.api.report(env, creds, body);
    const res = await this.api.clear(env, creds, body);
    // 303 = الاعتماد معطّل مؤقتاً من الهيئة، فتُرسل القياسية عبر الإبلاغ
    if (res.status === 303) return this.api.report(env, creds, body);
    return res;
  }


  /** المفتاح وشهادة الإنتاج للوضع النشط، من جدول environments */
  private async productionSigner(env: ZatcaEnvName) {
    const secrets = await this.environments.getSecrets(env);
    if (!secrets.production || !secrets.privateKeyPem) {
      throw new BadRequestException('الوحدة غير مسجلة. نفّذ POST /zatca/onboard أولاً، أو استخدم ?dryRun=true للتجربة.');
    }
    return {
      env,
      creds: secrets.production,
      privateKeyPem: secrets.privateKeyPem,
      certBase64: tokenToCertBase64(secrets.production.binarySecurityToken),
    };
  }

  /** شهادة ذاتية التوقيع للتجربة (dryRun)، تُنشأ مرة لكل وضع وتُحفظ مشفرة */
  private async localSigner(env: ZatcaEnvName) {
    let local = (await this.environments.getSecrets(env)).localTest;
    if (!local) {
      const seller = this.environments.toSeller(await this.environments.get(env));
      const { privateKeyPem } = generateKeyAndCsr({
        commonName: 'local-test', orgUnit: 'test', orgName: 'test', vatNumber: seller.vatNumber || '399999999900003',
        solutionName: 'test', model: 'test', serial: 'test', invoiceType: '1100', location: 'test',
        industry: 'test', certTemplateName: envProfile(env).certTemplateName,
      });
      local = { privateKeyPem, certPem: createSelfSignedCert(privateKeyPem) };
      await this.environments.saveLocalTest(env, local);
      this.logger.log(`[${env}] تم إنشاء شهادة محلية للتجربة (dryRun)`);
    }
    return {
      env,
      creds: null as unknown as Credentials,
      privateKeyPem: local.privateKeyPem,
      certBase64: pemToCertBase64(local.certPem),
    };
  }
}
