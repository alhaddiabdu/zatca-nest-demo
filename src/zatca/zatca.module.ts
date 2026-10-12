import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceCheckEntity } from '../database/entities/compliance-check.entity';
import { InvoiceEntity } from '../database/entities/invoice.entity';
import { ZatcaApi } from './api/zatca-api.port';
import { ZatcaApiService } from './api/zatca-api.service';
import { FakeZatcaApiService } from './api/fake-zatca-api.service';
import { EnvironmentsModule } from './environments/environments.module';
import { ModesModule } from './modes/modes.module';
import { OnboardingService } from './onboarding.service';
import { InvoiceService } from './invoice.service';
import { ChainService } from './chain/chain.service';
import { RetryService } from './submission/retry.service';
import { RetryScheduler } from './submission/retry.scheduler';
import { ZatcaController } from './zatca.controller';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceEntity, ComplianceCheckEntity]),
    EnvironmentsModule,
    ModesModule,
  ],
  controllers: [ZatcaController, InvoicesController],
  providers: [
    {
      // live = الاتصال الحقيقي بالهيئة، fake = ردود محلية (الافتراضي)
      provide: ZatcaApi,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('ZATCA_TRANSPORT') === 'live' ? new ZatcaApiService() : new FakeZatcaApiService(),
    },
    OnboardingService,
    InvoiceService,
    ChainService,
    RetryService,
    RetryScheduler,
    InvoicesService,
  ],
})
export class ZatcaModule {}
