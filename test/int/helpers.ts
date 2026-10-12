import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/database.options';

/** قاعدة نظيفة: حذف كل الجداول ثم تشغيل كل الـ migrations (والبذور) */
export async function resetDatabase(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(process.env.DATABASE_URL));
  await ds.initialize();
  try {
    await ds.query('DROP SCHEMA public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}
