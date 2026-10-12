/**
 * اختبارات التكامل: تعمل على قاعدة PostgreSQL حقيقية من TEST_DATABASE_URL
 * (اسمها يجب أن ينتهي بـ _test لأن الاختبارات تحذف الجداول وتعيد إنشاءها).
 * تعمل واحدة تلو الأخرى (--runInBand) لأنها تشترك في نفس القاعدة.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/int/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/int/setup-env.ts'],
  testTimeout: 60000,
};
