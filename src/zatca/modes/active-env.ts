import { ZatcaEnvName } from '../../database/entities/environment.entity';

/** اسم الوضع ولونه في الواجهة */
export const MODE_META: Record<ZatcaEnvName, { label: string; color: 'green' | 'orange' | 'red' }> = {
  'developer-portal': { label: 'بوابة المطورين', color: 'green' },
  simulation: { label: 'المحاكاة', color: 'orange' },
  core: { label: 'الإنتاج', color: 'red' },
};

/** الكلمة التي يجب كتابتها حرفياً لتفعيل الإنتاج */
export const CORE_CONFIRMATION = 'CORE';
