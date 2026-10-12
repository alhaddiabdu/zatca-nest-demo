import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceCheckEntity } from '../database/entities/compliance-check.entity';
import { InvoiceEntity } from '../database/entities/invoice.entity';
import zatcaConfig from './zatca.config';
import { ZatcaApi } from './api/zatca-api.port';
import { ZatcaApiService } from './api/zatca-api.service';
import { FakeZatcaApiService } from './api/fake-zatca-api.service';
import { EgsStoreService } from './storage/egs-store.service';
import { EnvironmentsModule } from './environments/environments.module';
import { ModesModule } from './modes/modes.module';
import { OnboardingService } from './onboarding.service';
import { InvoiceService } from './invoice.service';
import { ZatcaController } from './zatca.controller';

@Module({
  imports: [
    ConfigModule.forFeature(zatcaConfig),
    TypeOrmModule.forFeature([InvoiceEntity, ComplianceCheckEntity]),
    EnvironmentsModule,
    ModesModule,
  ],
  controllers: [ZatcaController],
  providers: [
    {
      // live = الاتصال الحقيقي بالهيئة، fake = ردود محلية (الافتراضي)
      provide: ZatcaApi,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('ZATCA_TRANSPORT') === 'live' ? new ZatcaApiService() : new FakeZatcaApiService(),
    },
    EgsStoreService,
    OnboardingService,
    InvoiceService,
  ],
})
export class ZatcaModule {}
