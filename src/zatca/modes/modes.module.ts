import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSettingsEntity } from '../../database/entities/app-settings.entity';
import { InvoiceEntity } from '../../database/entities/invoice.entity';
import { EnvironmentsModule } from '../environments/environments.module';
import { ModeService } from './mode.service';
import { ModesController } from './modes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppSettingsEntity, InvoiceEntity]), EnvironmentsModule],
  controllers: [ModesController],
  providers: [ModeService],
  exports: [ModeService],
})
export class ModesModule {}
