import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { ZatcaApi } from '../../src/zatca/api/zatca-api.port';
import { ZatcaModule } from '../../src/zatca/zatca.module';

/**
 * التطبيق كاملاً (بدون المُجدوِل) على قاعدة الاختبار، بنفس الـ pipe العام في main.ts.
 * الناقل الوهمي يحل محل الحقيقي: لا اتصال بالهيئة أبداً في الاختبارات.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, ZatcaModule],
  })
    .overrideProvider(ZatcaApi)
    .useClass(FakeZatcaApiService)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}
