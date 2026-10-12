import type { EnvSettings, Mode, Status } from './types';

/** شاشات التدفق الرئيسية */
export type Screen = 'modes' | 'settings' | 'onboard' | 'dashboard';

/**
 * أين يذهب المستخدم الآن (القسم 2.3 في الخطة):
 * لا وضع ← البطاقات | إعدادات ناقصة ← الإعدادات | غير مسجّل ← التسجيل | غير ذلك ← لوحة التحكم
 */
export function nextScreen(active: Mode | null, settings: EnvSettings | null, status: Status | null): Screen {
  if (!active) return 'modes';
  if (!settings || !settings.complete) return 'settings';
  if (!status || !status.onboarded) return 'onboard';
  return 'dashboard';
}
