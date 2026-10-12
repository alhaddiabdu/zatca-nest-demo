import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import { AppSettingsEntity } from './entities/app-settings.entity';
import { ComplianceCheckEntity } from './entities/compliance-check.entity';
import { EnvironmentEntity } from './entities/environment.entity';
import { InvoiceEntity } from './entities/invoice.entity';

/** كل الكيانات، مسجّلة هنا لأن التطبيق وأداة الـ migrations يستخدمان نفس الإعدادات */
export const ENTITIES = [EnvironmentEntity, AppSettingsEntity, InvoiceEntity, ComplianceCheckEntity];

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
    entities: ENTITIES,
  };
}
