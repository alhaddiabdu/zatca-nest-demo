import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MODE_META } from './zatca/modes/active-env';
import { ModeService } from './zatca/modes/mode.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // الوضع النشط من قاعدة البيانات (app_settings)، وليس من متغيرات البيئة
  const active = await app.get(ModeService, { strict: false }).getActive();
  const mode = active ? `${active} (${MODE_META[active].label})` : 'لم يُختر بعد';
  Logger.log(`🚀 يعمل على http://localhost:${port}  (الوضع النشط: ${mode})`);
}
bootstrap();
