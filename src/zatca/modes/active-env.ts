import { ZatcaEnvName } from '../../database/entities/environment.entity';

/** اسم الوضع ولونه في الواجهة */
export const MODE_META: Record<ZatcaEnvName, { label: string; color: 'green' | 'orange' | 'red' }> = {
  'developer-portal': { label: 'بوابة المطورين', color: 'green' },
  simulation: { label: 'المحاكاة', color: 'orange' },
  core: { label: 'الإنتاج', color: 'red' },
};

/**
 * الأوضاع المعطّلة حالياً: PUT /zatca/mode يرفضها، وبطاقتها في الواجهة غير قابلة للاختيار.
 * كود الإنتاج (ومنه تأكيد CORE) باقٍ كما هو؛ لإعادة تفعيله احذفه من هذه القائمة.
 */
export const DISABLED_MODES: readonly ZatcaEnvName[] = ['core'];

export const isModeAvailable = (env: ZatcaEnvName) => !DISABLED_MODES.includes(env);

/** الكلمة التي يجب كتابتها حرفياً لتفعيل الإنتاج */
export const CORE_CONFIRMATION = 'CORE';
