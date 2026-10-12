import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { randomBytes, randomInt } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pemToCertBase64 } from '../crypto/certificate';
import { Credentials } from '../storage/egs-store.service';
import { ZatcaEnv } from '../zatca.config';
import { CsidResponse, SubmitBody, ZatcaApi, ZatcaResponse } from './zatca-api.port';

/**
 * ناقل وهمي لمنصة فاتورة (ZATCA_TRANSPORT=fake): لا يتصل بأي خادم.
 *
 * - ينشئ جهة إصدار (CA) محلية عند بدء التشغيل، ويوقّع بها الـ CSR المستلم،
 *   فتكون الشهادة لنفس مفتاح الـ EGS ويعمل التوقيع والتحقق كما هما.
 * - binarySecurityToken = Base64 لنص الشهادة، بنفس شكل رد الهيئة.
 * - حالات للتجربة حسب رقم الفاتورة (cbc:ID):
 *     FAIL503 ← 503 | REJECT400 ← 400 مع أخطاء | WARN202 ← 202 مع تحذير | TIMEOUT ← انقطاع اتصال
 */
@Injectable()
export class FakeZatcaApiService implements ZatcaApi, OnModuleDestroy {
  private readonly logger = new Logger('FakeZatcaApi');
  private readonly caDir = mkdtempSync(join(tmpdir(), 'fake-zatca-ca-'));
  /** الـ CSR لكل طلب امتثال، لإصدار شهادة الإنتاج لاحقاً لنفس المفتاح */
  private readonly csrByRequestId = new Map<string, string>();
  /** عدد الاستدعاءات لكل دالة (للاختبارات) */
  readonly calls: Record<string, number> = {};
  /** محاكاة توقف الهيئة: كل الإرسال يعود 503 حتى يُلغى (للاختبارات) */
  private outage = false;

  constructor() {
    const key = join(this.caDir, 'ca.key');
    execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key]);
    execFileSync('openssl', [
      'req', '-new', '-x509', '-sha256', '-days', '3650', '-key', key,
      '-subj', '/CN=Fake ZATCA Local CA/O=Local Development/C=SA', '-out', join(this.caDir, 'ca.pem'),
    ]);
    this.logger.warn('ZATCA_TRANSPORT=fake: لا اتصال بالهيئة، كل الردود محلية للتجربة فقط');
  }

  setOutage(on: boolean) {
    this.outage = on;
  }

  onModuleDestroy() {
    rmSync(this.caDir, { recursive: true, force: true });
  }

  async requestComplianceCsid(env: ZatcaEnv, csrBase64: string, otp: string): Promise<ZatcaResponse<CsidResponse>> {
    this.count('requestComplianceCsid');
    if (!/^\d{6}$/.test(otp ?? '')) {
      return this.reply(env, '/compliance', 400, { errors: [{ code: 'Invalid-OTP', message: 'OTP غير صالح (ناقل وهمي)' }] });
    }
    const csrPem = Buffer.from(csrBase64, 'base64').toString('utf8');
    const requestId = String(Date.now()) + String(randomInt(100, 999));
    const body = this.issueCsid(csrPem, requestId);
    this.csrByRequestId.set(requestId, csrPem);
    return this.reply(env, '/compliance', 200, body);
  }

  async complianceCheck(env: ZatcaEnv, _creds: Credentials, body: SubmitBody): Promise<ZatcaResponse> {
    this.count('complianceCheck');
    const standard = this.isStandard(body);
    return this.reply(env, '/compliance/invoices', 200, {
      validationResults: this.passResults(),
      reportingStatus: standard ? null : 'REPORTED',
      clearanceStatus: standard ? 'CLEARED' : null,
    });
  }

  async requestProductionCsid(env: ZatcaEnv, complianceCreds: Credentials): Promise<ZatcaResponse<CsidResponse>> {
    this.count('requestProductionCsid');
    const csrPem = this.csrByRequestId.get(String(complianceCreds.requestId));
    if (!csrPem) {
      return this.reply(env, '/production/csids', 400, { errors: [{ code: 'Missing-ComplianceSteps', message: 'طلب امتثال غير معروف (ناقل وهمي)' }] });
    }
    return this.reply(env, '/production/csids', 200, this.issueCsid(csrPem, String(Date.now())));
  }

  async renewProductionCsid(
    env: ZatcaEnv,
    _productionCreds: Credentials,
    csrBase64: string,
    otp: string,
  ): Promise<ZatcaResponse<CsidResponse>> {
    this.count('renewProductionCsid');
    if (!/^\d{6}$/.test(otp ?? '')) {
      return this.reply(env, '/production/csids', 400, { errors: [{ code: 'Invalid-OTP', message: 'OTP غير صالح (ناقل وهمي)' }] });
    }
    const csrPem = Buffer.from(csrBase64, 'base64').toString('utf8');
    return this.reply(env, '/production/csids', 200, this.issueCsid(csrPem, String(Date.now())));
  }

  async report(env: ZatcaEnv, _creds: Credentials, body: SubmitBody): Promise<ZatcaResponse> {
    this.count('report');
    return this.submit(env, '/invoices/reporting/single', body, false);
  }

  async clear(env: ZatcaEnv, _creds: Credentials, body: SubmitBody): Promise<ZatcaResponse> {
    this.count('clear');
    return this.submit(env, '/invoices/clearance/single', body, true);
  }

  // ===== داخلي =====

  private submit(env: ZatcaEnv, path: string, body: SubmitBody, clearance: boolean): ZatcaResponse {
    const id = this.invoiceNumber(body);
    if (this.outage) {
      return this.reply(env, path, 503, { message: 'Service Unavailable (انقطاع تجريبي)' });
    }
    if (id.includes('TIMEOUT')) {
      this.logger.warn(`[${env}] POST ${path} ← انقطاع اتصال تجريبي (${id})`);
      throw new ServiceUnavailableException('تعذر الاتصال بمنصة فاتورة: ETIMEDOUT (ناقل وهمي)');
    }
    if (id.includes('FAIL503')) {
      return this.reply(env, path, 503, { message: 'Service Unavailable (ناقل وهمي)' });
    }
    if (id.includes('REJECT400')) {
      return this.reply(env, path, 400, {
        validationResults: {
          infoMessages: [],
          warningMessages: [],
          errorMessages: [
            { type: 'ERROR', code: 'FAKE-REJECTED', category: 'FAKE', message: `رفض تجريبي من الناقل الوهمي (${id})`, status: 'ERROR' },
          ],
          status: 'ERROR',
        },
        reportingStatus: clearance ? null : 'NOT_REPORTED',
        clearanceStatus: clearance ? 'NOT_CLEARED' : null,
      });
    }
    const warn = id.includes('WARN202');
    const validationResults = warn
      ? {
          ...this.passResults(),
          warningMessages: [
            { type: 'WARNING', code: 'FAKE-WARNING', category: 'FAKE', message: `تحذير تجريبي من الناقل الوهمي (${id})`, status: 'WARNING' },
          ],
          status: 'WARNING',
        }
      : this.passResults();
    return this.reply(env, path, warn ? 202 : 200, {
      validationResults,
      reportingStatus: clearance ? null : 'REPORTED',
      clearanceStatus: clearance ? 'CLEARED' : null,
      // الاعتماد الحقيقي يعيد الفاتورة مختومة؛ الوهمي يعيدها كما هي
      ...(clearance ? { clearedInvoice: body.invoice } : {}),
    });
  }

  private issueCsid(csrPem: string, requestId: string): CsidResponse {
    const dir = mkdtempSync(join(this.caDir, 'req-'));
    try {
      const csrPath = join(dir, 'csr.pem');
      const certPath = join(dir, 'cert.pem');
      writeFileSync(csrPath, csrPem);
      execFileSync('openssl', [
        'x509', '-req', '-sha256', '-days', '365', '-in', csrPath,
        '-CA', join(this.caDir, 'ca.pem'), '-CAkey', join(this.caDir, 'ca.key'),
        '-set_serial', '0x' + randomBytes(8).toString('hex'), '-out', certPath,
      ], { stdio: 'pipe' });
      const certBase64 = pemToCertBase64(readFileSync(certPath, 'utf8'));
      return {
        requestID: requestId,
        dispositionMessage: 'ISSUED',
        binarySecurityToken: Buffer.from(certBase64, 'utf8').toString('base64'),
        secret: randomBytes(24).toString('base64'),
        errors: null,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private passResults() {
    return {
      infoMessages: [
        { type: 'INFO', code: 'XSD_ZATCA_VALID', category: 'XSD validation', message: 'Complied with UBL 2.1 standards in line with ZATCA specifications (fake)', status: 'PASS' },
      ],
      warningMessages: [],
      errorMessages: [],
      status: 'PASS',
    };
  }

  private xml(body: SubmitBody): string {
    return Buffer.from(body.invoice ?? '', 'base64').toString('utf8');
  }

  /** رقم الفاتورة: أول cbc:ID بعد ProfileID (قبله معرّفات التوقيع) */
  private invoiceNumber(body: SubmitBody): string {
    return /<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>([^<]*)<\/cbc:ID>/.exec(this.xml(body))?.[1] ?? '';
  }

  private isStandard(body: SubmitBody): boolean {
    return /<cbc:InvoiceTypeCode name="01/.test(this.xml(body));
  }

  private count(method: string) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
  }

  /** مثل الناقل الحقيقي: جسم الرد كما هو، سواء كان نجاحاً أو أخطاء */
  private reply(env: ZatcaEnv, path: string, status: number, body: any): ZatcaResponse<any> {
    this.logger.log(`[${env}] ${path} ← ${status} (ناقل وهمي)`);
    return { status, ok: status === 200 || status === 202, body };
  }
}
