import { parseMasterKey } from '../security/crypto-box.service';

/**
 * يُستدعى من ConfigModule عند الإقلاع. أي متغير ناقص أو غير صالح يوقف التشغيل
 * برسالة تذكر كل المشاكل مرة واحدة. لا تُطبع قيم الأسرار.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  try {
    parseMasterKey(config.MASTER_KEY as string | undefined);
  } catch (e) {
    const message = (e as Error).message;
    errors.push(message.includes('openssl') ? message : `${message}. لتوليده: openssl rand -base64 32`);
  }

  const databaseUrl = config.DATABASE_URL as string | undefined;
  if (!databaseUrl) {
    errors.push('DATABASE_URL مفقود (مثال في .env.example)');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL يجب أن يبدأ بـ postgres:// أو postgresql://');
  }

  if (errors.length) {
    throw new Error(`إعدادات البيئة غير صالحة، لا يمكن التشغيل:\n- ${errors.join('\n- ')}`);
  }
  return config;
}
