import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`🚀 يعمل على http://localhost:${port}  (ZATCA_ENV=${process.env.ZATCA_ENV ?? 'developer-portal'})`);
}
bootstrap();
