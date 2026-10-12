import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID, X509Certificate } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ComplianceCheckEntity } from '../database/entities/compliance-check.entity';
import { ZatcaEnvName } from '../database/entities/environment.entity';
import { InvoiceEntity, InvoiceStatus } from '../database/entities/invoice.entity';
import { envProfile, SellerInfo } from './zatca.config';
import { Credentials, ZatcaApi } from './api/zatca-api.port';
import { EnvironmentsService } from './environments/environments.service';
import { ModeService } from './modes/mode.service';
import { MODE_META } from './modes/active-env';
import { generateKeyAndCsr } from './crypto/csr';
import { certBase64ToPem, tokenToCertBase64 } from './crypto/certificate';
import { INITIAL_PIH, signInvoice } from './crypto/signer';
import { buildInvoiceXml, riyadhDateTime } from './xml/invoice-builder';
import { DocumentKind, InvoiceCategory } from './xml/invoice.types';

/** في بوابة المطورين يعمل أي OTP، فيُرسل هذا تلقائياً */
export const DEVELOPER_PORTAL_OTP = '123345';

/**
 * رحلة التسجيل (الخطوات 1 إلى 5) للوضع النشط — مرة واحدة لكل وضع.
 * بيانات المنشأة والمفتاح والشهادات في جدول environments، والفحوصات في compliance_checks.
 * تسجيلان متزامنان لنفس الوضع ممنوعان بقفل استشاري في PostgreSQL (يعمل عبر أكثر من نسخة).
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly api: ZatcaApi,
    private readonly dataSource: DataSource,
    private readonly environments: EnvironmentsService,
    private readonly modes: ModeService,
    @InjectRepository(InvoiceEntity) private readonly invoices: Repository<InvoiceEntity>,
    @InjectRepository(ComplianceCheckEntity) private readonly checks: Repository<ComplianceCheckEntity>,
  ) {}

  async onboard(otp?: string, force = false) {
    const env = await this.modes.requireActive();
    return this.withOnboardingLock(env, async () => {
      const row = await this.environments.get(env);

      const missing = this.environments.missingSettings(row);
      if (missing.length) {
        throw new BadRequestException({ code: 'SETTINGS_INCOMPLETE', message: 'أكمل إعدادات المنشأة أولاً', missing });
      }
      if (row.productionTokenEnc && !force) {
        return { message: 'الوحدة مسجلة مسبقاً. أرسل force=true لإعادة التسجيل.', env, onboardedAt: row.onboardedAt };
      }
      const pending = await this.invoices.count({ where: { env, status: 'PENDING' } });
      if (pending > 0) {
        throw new ConflictException({
          code: 'PENDING_EXISTS',
          message: `توجد ${pending} فواتير معلّقة في هذا الوضع. أرسلها أولاً قبل إعادة التسجيل.`,
          pending,
        });
      }
      const otpToSend = otp || (env === 'developer-portal' ? DEVELOPER_PORTAL_OTP : undefined);
      if (!otpToSend) {
        throw new BadRequestException({ code: 'OTP_REQUIRED', message: 'أدخل رمز OTP من بوابة فاتورة' });
      }

      // 1) المفتاح الخاص + CSR
      const seller = this.environments.toSeller(row);
      const egs = this.environments.toEgs(row);
      const csr = generateKeyAndCsr({
        commonName: egs.commonName,
        orgUnit: egs.orgUnit,
        orgName: seller.name,
        vatNumber: seller.vatNumber,
        solutionName: egs.solutionName,
        model: egs.model,
        serial: egs.serial,
        invoiceType: egs.invoiceType,
        location: egs.location,
        industry: egs.industry,
        certTemplateName: envProfile(env).certTemplateName,
      });
      this.logger.log(`[${env}] 1) تم توليد المفتاح الخاص و CSR`);

      // 2+3) OTP ← شهادة الامتثال
      const ccsid = await this.api.requestComplianceCsid(env, csr.csrBase64, otpToSend);
      if (!ccsid.ok) throw new BadRequestException({ step: 'compliance-csid', zatca: ccsid });
      const compliance: Credentials = {
        binarySecurityToken: ccsid.body.binarySecurityToken,
        secret: ccsid.body.secret,
        requestId: String(ccsid.body.requestID),
      };
      this.logger.log(`[${env}] 3) تم استلام شهادة الامتثال (requestID=${compliance.requestId})`);

      // 4) فحوصات الامتثال: كل الأنواع المذكورة في نوع الفواتير (مثل 1100)
      const runId = randomUUID();
      const checks = await this.runComplianceChecks(env, runId, seller, egs.invoiceType, csr.privateKeyPem, compliance);
      if (checks.some((c) => !c.ok)) {
        throw new BadRequestException({ step: 'compliance-checks', runId, results: checks });
      }
      this.logger.log(`[${env}] 4) نجحت فحوصات الامتثال (${checks.length} وثائق)`);

      // 5) شهادة الإنتاج
      const pcsid = await this.api.requestProductionCsid(env, compliance);
      if (!pcsid.ok) throw new BadRequestException({ step: 'production-csid', zatca: pcsid });
      const production: Credentials = {
        binarySecurityToken: pcsid.body.binarySecurityToken,
        secret: pcsid.body.secret,
        requestId: String(pcsid.body.requestID),
      };
      this.logger.log(`[${env}] 5) تم استلام شهادة الإنتاج ✔`);

      // إعادة التسجيل تبدأ سلسلة جديدة برقم دورة جديد
      const chainEpoch = row.productionTokenEnc ? row.chainEpoch + 1 : row.chainEpoch;
      await this.environments.saveCredentials(env, {
        privateKeyPem: csr.privateKeyPem,
        csrPem: csr.csrPem,
        compliance,
        production,
        productionCertNotAfter: this.certNotAfter(production.binarySecurityToken),
        onboardedAt: new Date(),
        chain: { chainEpoch, icv: 0, pih: INITIAL_PIH },
      });
      return { message: 'تم التسجيل بنجاح، يمكنك الآن إرسال الفواتير', env, runId, complianceChecks: checks };
    });
  }

  /** يمنع تسجيلين متزامنين لنفس الوضع، حتى من نسختين مختلفتين من التطبيق */
  private async withOnboardingLock<T>(env: ZatcaEnvName, fn: () => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const key = `zatca-onboard:${env}`;
    try {
      const [{ locked }] = await runner.query('select pg_try_advisory_lock(hashtext($1)) as locked', [key]);
      if (!locked) {
        throw new ConflictException({ code: 'ONBOARDING_IN_PROGRESS', message: 'يوجد تسجيل جارٍ لهذا الوضع، انتظر حتى ينتهي' });
      }
      try {
        return await fn();
      } finally {
        await runner.query('select pg_advisory_unlock(hashtext($1))', [key]);
      }
    } finally {
      await runner.release();
    }
  }

  private async runComplianceChecks(
    env: ZatcaEnvName,
    runId: string,
    seller: SellerInfo,
    invoiceType: string,
    privateKeyPem: string,
    creds: Credentials,
  ) {
    const categories: InvoiceCategory[] = [];
    if (invoiceType[0] === '1') categories.push('standard');
    if (invoiceType[1] === '1') categories.push('simplified');
    const kinds: DocumentKind[] = ['invoice', 'credit', 'debit'];

    const certBase64 = tokenToCertBase64(creds.binarySecurityToken);
    const results: Array<{ document: string; status: number; ok: boolean; response: unknown }> = [];
    let icv = 0;
    let pih = INITIAL_PIH;

    for (const category of categories) {
      for (const kind of kinds) {
        icv += 1;
        const { date, time } = riyadhDateTime();
        const uuid = randomUUID();
        const built = buildInvoiceXml(
          {
            id: `COMPLIANCE-${icv}`,
            uuid,
            category,
            kind,
            issueDate: date,
            issueTime: time,
            icv,
            pih,
            buyer:
              category === 'standard'
                ? {
                    name: 'عميل تجريبي',
                    vatNumber: '300000000000003',
                    address: { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' },
                  }
                : undefined,
            lines: [{ name: 'منتج تجريبي', quantity: 1, unitPrice: 100 }],
            originalInvoiceId: kind === 'invoice' ? undefined : 'COMPLIANCE-1',
            reason: kind === 'invoice' ? undefined : 'تعديل على الفاتورة',
          },
          seller,
        );
        const signed = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields });
        const res = await this.api.complianceCheck(env, creds, {
          invoiceHash: signed.invoiceHash,
          uuid,
          invoice: Buffer.from(signed.signedXml, 'utf8').toString('base64'),
        });
        const document = `${category}-${kind}`;
        results.push({ document, status: res.status, ok: res.ok, response: res.body });
        await this.checks.save(this.checks.create({
          env,
          runId,
          document,
          icv,
          uuid,
          invoiceHash: signed.invoiceHash,
          httpStatus: res.status,
          ok: res.ok,
          response: (res.body ?? null) as Record<string, unknown> | null,
        }));
        pih = signed.invoiceHash;
      }
    }
    return results;
  }

  private certNotAfter(binarySecurityToken: string): Date | null {
    try {
      return new Date(new X509Certificate(certBase64ToPem(tokenToCertBase64(binarySecurityToken))).validTo);
    } catch {
      return null;
    }
  }

  /** حالة الوضع النشط وإحصاءات لوحة التحكم في طلب واحد */
  async status() {
    const env = await this.modes.requireActive();
    const row = await this.environments.get(env);
    const counts = await this.invoices
      .createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('count(*)::int', 'count')
      .where('i.env = :env', { env })
      .groupBy('i.status')
      .getRawMany<{ status: InvoiceStatus; count: number }>();
    const countsByStatus: Record<InvoiceStatus, number> = {
      DRY_RUN: 0, PENDING: 0, ACCEPTED: 0, ACCEPTED_WITH_WARNINGS: 0, REJECTED: 0,
    };
    for (const c of counts) countsByStatus[c.status] = c.count;
    // المبسطة يجب أن تُبلَّغ خلال 24 ساعة
    const pendingOverdue = await this.invoices
      .createQueryBuilder('i')
      .where('i.env = :env', { env })
      .andWhere(`i.status = 'PENDING' AND i.category = 'simplified'`)
      .andWhere(`i.created_at < now() - interval '24 hours'`)
      .getCount();

    return {
      env,
      mode: { env, ...MODE_META[env] },
      state: this.environments.state(row),
      seller: this.environments.toSeller(row),
      onboarded: !!row.productionTokenEnc,
      onboardedAt: row.onboardedAt ?? null,
      productionCertNotAfter: row.productionCertNotAfter ?? null,
      chain: { icv: row.icv, pih: row.pih, chainEpoch: row.chainEpoch },
      pendingCount: countsByStatus.PENDING,
      pendingOverdue,
      countsByStatus,
    };
  }
}
