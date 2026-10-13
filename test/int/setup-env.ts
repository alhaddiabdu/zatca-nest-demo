import { randomBytes } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// يُنفّذ قبل كل ملف اختبار تكامل، قبل استيراد أي وحدة من التطبيق
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL مفقود. مثال: postgres://zatca:<pass>@localhost:5433/zatca_test');
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(`اسم قاعدة الاختبار يجب أن ينتهي بـ _test (الحالي: ${dbName})، لأن الاختبارات تحذف الجداول`);
}

process.env.DATABASE_URL = url;
process.env.MASTER_KEY = randomBytes(32).toString('base64');
// المُجدوِل لا يعمل وحده في الاختبارات؛ تُستدعى tick() يدوياً عند الحاجة
process.env.RETRY_SCHEDULER_ENABLED = 'false';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'zatca-int-data-'));
