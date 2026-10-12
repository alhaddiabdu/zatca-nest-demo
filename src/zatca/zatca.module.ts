import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import zatcaConfig from './zatca.config';
import { ZatcaApiService } from './api/zatca-api.service';
import { EgsStoreService } from './storage/egs-store.service';
import { OnboardingService } from './onboarding.service';
import { InvoiceService } from './invoice.service';
import { ZatcaController } from './zatca.controller';

@Module({
  imports: [ConfigModule.forFeature(zatcaConfig)],
  controllers: [ZatcaController],
  providers: [ZatcaApiService, EgsStoreService, OnboardingService, InvoiceService],
})
export class ZatcaModule {}
