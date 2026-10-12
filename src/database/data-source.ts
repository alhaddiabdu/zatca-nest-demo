import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options';

// هذا الملف لأداة typeorm في سطر الأوامر فقط، وهي لا تقرأ .env وحدها
try {
  process.loadEnvFile();
} catch {
  // لا يوجد ملف .env، نكتفي بمتغيرات البيئة الحالية
}

export default new DataSource(buildDataSourceOptions(process.env.DATABASE_URL));
