import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { envProfile, ZatcaEnv } from '../zatca.config';
import { Credentials } from '../storage/egs-store.service';
import { CsidResponse, SubmitBody, ZatcaApi, ZatcaResponse } from './zatca-api.port';

export type { CsidResponse, SubmitBody, ZatcaResponse } from './zatca-api.port';

/**
 * كل الاتصالات مع منصة فاتورة. كل دالة تأخذ الوضع (البيئة) المستهدف أولاً.
 * status: 200 مقبول | 202 مقبول مع تحذيرات | 400 مرفوض | 401 مشكلة مصادقة
 *         303 الاعتماد غير مفعّل حالياً، أرسل الفاتورة القياسية عبر الإبلاغ
 */
@Injectable()
export class ZatcaApiService implements ZatcaApi {
  private readonly logger = new Logger(ZatcaApiService.name);

  private async request<T>(
    env: ZatcaEnv,
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<ZatcaResponse<T>> {
    const url = envProfile(env).baseUrl + path;
    this.logger.log(`${method} ${url}`);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Language': 'en',
          'Accept-Version': 'V2',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      throw new ServiceUnavailableException(`تعذر الاتصال بمنصة فاتورة: ${err?.cause?.code ?? err?.message}`);
    }
    const text = await res.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (res.status >= 400) this.logger.warn(`ZATCA ${res.status}: ${text.slice(0, 500)}`);
    return { status: res.status, ok: res.status === 200 || res.status === 202, body: parsed };
  }

  private basicAuth(c: Credentials): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${c.binarySecurityToken}:${c.secret}`).toString('base64'),
    };
  }

  /** الخطوة 3: CSR + OTP ← شهادة الامتثال */
  requestComplianceCsid(env: ZatcaEnv, csrBase64: string, otp: string) {
    return this.request<CsidResponse>(env, 'POST', '/compliance', { csr: csrBase64 }, { OTP: otp });
  }

  /** الخطوة 4: فحوصات الامتثال بالفواتير التجريبية */
  complianceCheck(env: ZatcaEnv, creds: Credentials, body: SubmitBody) {
    return this.request(env, 'POST', '/compliance/invoices', body, this.basicAuth(creds));
  }

  /** الخطوة 5: شهادة الإنتاج */
  requestProductionCsid(env: ZatcaEnv, complianceCreds: Credentials) {
    return this.request<CsidResponse>(
      env,
      'POST',
      '/production/csids',
      { compliance_request_id: String(complianceCreds.requestId) },
      this.basicAuth(complianceCreds),
    );
  }

  /** تجديد شهادة الإنتاج قبل انتهائها (CSR جديد + OTP جديد) */
  renewProductionCsid(env: ZatcaEnv, productionCreds: Credentials, csrBase64: string, otp: string) {
    return this.request<CsidResponse>(
      env,
      'PATCH',
      '/production/csids',
      { csr: csrBase64 },
      { ...this.basicAuth(productionCreds), OTP: otp },
    );
  }

  /** الخطوة 10: الفواتير المبسطة (B2C) — خلال 24 ساعة */
  report(env: ZatcaEnv, creds: Credentials, body: SubmitBody) {
    return this.request(env, 'POST', '/invoices/reporting/single', body, {
      ...this.basicAuth(creds),
      'Clearance-Status': '0',
    });
  }

  /** الخطوة 10: الفواتير القياسية (B2B) — قبل تسليمها للعميل */
  clear(env: ZatcaEnv, creds: Credentials, body: SubmitBody) {
    return this.request(env, 'POST', '/invoices/clearance/single', body, {
      ...this.basicAuth(creds),
      'Clearance-Status': '1',
    });
  }
}
