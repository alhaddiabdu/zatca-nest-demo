import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * إعدادات الاتصال المشتركة بين التطبيق وأداة سطر الأوامر (migrations).
 * synchronize ممنوع دائماً: أي تغيير في الجداول يكون عبر migration.
 */
export function buildDataSourceOptions(databaseUrl: string | undefined): DataSourceOptions {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL غير مضبوط. أضفه إلى ملف .env (انظر .env.example).');
  }
  return {
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    migrationsRun: false,
    // ‎.ts عند التشغيل بـ ts-node، و ‎.js بعد البناء في dist
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    entities: [],
  };
}
