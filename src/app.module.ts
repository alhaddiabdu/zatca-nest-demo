import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { ZatcaModule } from './zatca/zatca.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), ScheduleModule.forRoot(), DatabaseModule, ZatcaModule],
})
export class AppModule {}
