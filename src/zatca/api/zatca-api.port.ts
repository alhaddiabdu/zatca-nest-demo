import { ZatcaEnv } from '../zatca.config';

/** بيانات المصادقة من رد الهيئة (شهادة الامتثال أو الإنتاج) */
export interface Credentials {
  binarySecurityToken: string;
  secret: string;
  requestId?: string;
}

export interface CsidResponse {
  requestID: number | string;
  dispositionMessage: string;
  binarySecurityToken: string;
  secret: string;
  errors?: unknown;
}

export interface SubmitBody {
  invoiceHash: string;
  uuid: string;
  invoice: string; // XML بترميز Base64
}

export interface ZatcaResponse<T = any> {
  status: number;
  ok: boolean;
  body: T;
}

/**
 * واجهة الاتصال بمنصة فاتورة. لها تنفيذان:
 * - ZatcaApiService: الاتصال الحقيقي بالهيئة (ZATCA_TRANSPORT=live)
 * - FakeZatcaApiService: ردود محلية للتطوير والاختبار (ZATCA_TRANSPORT=fake)
 * تُستخدم كرمز حقن في Nest.
 */
export abstract class ZatcaApi {
  abstract requestComplianceCsid(env: ZatcaEnv, csrBase64: string, otp: string): Promise<ZatcaResponse<CsidResponse>>;
  abstract complianceCheck(env: ZatcaEnv, creds: Credentials, body: SubmitBody): Promise<ZatcaResponse>;
  abstract requestProductionCsid(env: ZatcaEnv, complianceCreds: Credentials): Promise<ZatcaResponse<CsidResponse>>;
  abstract renewProductionCsid(
    env: ZatcaEnv,
    productionCreds: Credentials,
    csrBase64: string,
    otp: string,
  ): Promise<ZatcaResponse<CsidResponse>>;
  abstract report(env: ZatcaEnv, creds: Credentials, body: SubmitBody): Promise<ZatcaResponse>;
  abstract clear(env: ZatcaEnv, creds: Credentials, body: SubmitBody): Promise<ZatcaResponse>;
}
