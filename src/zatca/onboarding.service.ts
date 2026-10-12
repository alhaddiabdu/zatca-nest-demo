import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import zatcaConfig from './zatca.config';
import { ZatcaApiService } from './api/zatca-api.service';
import { EgsStoreService } from './storage/egs-store.service';
import { generateKeyAndCsr } from './crypto/csr';
import { tokenToCertBase64 } from './crypto/certificate';
import { INITIAL_PIH, signInvoice } from './crypto/signer';
import { buildInvoiceXml, riyadhDateTime } from './xml/invoice-builder';
import { DocumentKind, InvoiceCategory } from './xml/invoice.types';

/**
 * رحلة التسجيل (الخطوات 1 إلى 5) — مرة واحدة لكل جهاز/فرع.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(zatcaConfig.KEY) private readonly config: ConfigType<typeof zatcaConfig>,
    private readonly api: ZatcaApiService,
    private readonly store: EgsStoreService,
  ) {}

  async onboard(otp: string, force = false) {
    return this.store.runExclusive(async () => {
      const state = this.store.load();
      if (state.production && !force) {
        return { message: 'الوحدة مسجلة مسبقاً. أرسل force=true لإعادة التسجيل.', onboardedAt: state.onboardedAt };
      }

      // 1) المفتاح الخاص + CSR
      const { seller, egs } = this.config;
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
        certTemplateName: this.config.certTemplateName,
      });
      this.logger.log('1) تم توليد المفتاح الخاص و CSR');

      // 2+3) OTP ← شهادة الامتثال
      const ccsid = await this.api.requestComplianceCsid(this.config.env, csr.csrBase64, otp);
      if (!ccsid.ok) throw new BadRequestException({ step: 'compliance-csid', zatca: ccsid });
      const compliance = {
        binarySecurityToken: ccsid.body.binarySecurityToken,
        secret: ccsid.body.secret,
        requestId: String(ccsid.body.requestID),
      };
      this.logger.log(`3) تم استلام شهادة الامتثال (requestID=${compliance.requestId})`);

      // 4) فحوصات الامتثال: كل الأنواع المذكورة في EGS_INVOICE_TYPE
      const checks = await this.runComplianceChecks(csr.privateKeyPem, compliance);
      const failed = checks.filter((c) => !c.ok);
      if (failed.length) {
        throw new BadRequestException({ step: 'compliance-checks', results: checks });
      }
      this.logger.log(`4) نجحت فحوصات الامتثال (${checks.length} وثائق)`);

      // 5) شهادة الإنتاج
      const pcsid = await this.api.requestProductionCsid(this.config.env, compliance);
      if (!pcsid.ok) throw new BadRequestException({ step: 'production-csid', zatca: pcsid });
      this.logger.log('5) تم استلام شهادة الإنتاج ✔');

      this.store.save({
        privateKeyPem: csr.privateKeyPem,
        csrPem: csr.csrPem,
        compliance,
        production: {
          binarySecurityToken: pcsid.body.binarySecurityToken,
          secret: pcsid.body.secret,
          requestId: String(pcsid.body.requestID),
        },
        chain: { icv: 0, pih: INITIAL_PIH },
        onboardedAt: new Date().toISOString(),
      });

      return { message: 'تم التسجيل بنجاح، يمكنك الآن إرسال الفواتير', env: this.config.env, complianceChecks: checks };
    });
  }

  private async runComplianceChecks(
    privateKeyPem: string,
    creds: { binarySecurityToken: string; secret: string },
  ) {
    const type = this.config.egs.invoiceType; // مثل 1100
    const categories: InvoiceCategory[] = [];
    if (type[0] === '1') categories.push('standard');
    if (type[1] === '1') categories.push('simplified');
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
          this.config.seller,
        );
        const signed = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields });
        const res = await this.api.complianceCheck(this.config.env, creds, {
          invoiceHash: signed.invoiceHash,
          uuid,
          invoice: Buffer.from(signed.signedXml, 'utf8').toString('base64'),
        });
        results.push({ document: `${category}-${kind}`, status: res.status, ok: res.ok, response: res.body });
        pih = signed.invoiceHash;
      }
    }
    return results;
  }

  status() {
    const s = this.store.load();
    return {
      env: this.config.env,
      seller: this.config.seller,
      onboarded: !!s.production,
      onboardedAt: s.onboardedAt ?? null,
      chain: s.chain,
      pendingCount: s.pending?.length ?? 0,
    };
  }
}
