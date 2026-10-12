import { InvoiceEntity } from '../../database/entities/invoice.entity';
import { ZatcaEnvName } from '../../database/entities/environment.entity';
import { Credentials, SubmitBody, ZatcaApi, ZatcaResponse } from '../api/zatca-api.port';
import { classifyResponse } from './classify';

export interface SubmitResult {
  res?: ZatcaResponse;
  networkError?: string;
  channel: 'reporting' | 'clearance';
}

/**
 * الخطوة 10: المبسطة ← الإبلاغ، القياسية ← الاعتماد.
 * 303 = الاعتماد معطّل مؤقتاً من الهيئة، فتُرسل القياسية عبر الإبلاغ.
 * انقطاع الاتصال لا يرمي خطأ، بل يُعاد كـ networkError ليُصنَّف PENDING.
 */
export async function submitInvoice(
  api: ZatcaApi,
  env: ZatcaEnvName,
  category: 'standard' | 'simplified',
  creds: Credentials,
  body: SubmitBody,
): Promise<SubmitResult> {
  let channel: SubmitResult['channel'] = category === 'simplified' ? 'reporting' : 'clearance';
  try {
    if (channel === 'reporting') return { res: await api.report(env, creds, body), channel };
    const res = await api.clear(env, creds, body);
    if (res.status === 303) {
      channel = 'reporting';
      return { res: await api.report(env, creds, body), channel };
    }
    return { res, channel };
  } catch (err) {
    return { networkError: String((err as Error)?.message ?? err), channel };
  }
}

/** حقول الصف بعد محاولة إرسال رقم attempts */
export function outcomeFields(result: SubmitResult, attempts: number, now = new Date()): Partial<InvoiceEntity> {
  const outcome = classifyResponse({ httpStatus: result.res?.status, networkError: result.networkError, attempts, now });
  const body = result.res?.body as Record<string, unknown> | undefined;
  const { clearedInvoice, ...response } = body ?? {};
  return {
    status: outcome.status,
    attempts,
    nextRetryAt: outcome.nextRetryAt,
    lastError: outcome.lastError,
    httpStatus: result.res?.status ?? null,
    zatcaResponse: body ? response : null,
    submissionChannel: result.channel,
    submittedAt: outcome.final ? now : null,
    // في الاعتماد تعيد الهيئة الفاتورة مختومة، وهي النسخة التي تُسلَّم للعميل
    ...(typeof clearedInvoice === 'string' ? { clearedXml: Buffer.from(clearedInvoice, 'base64').toString('utf8') } : {}),
  };
}
