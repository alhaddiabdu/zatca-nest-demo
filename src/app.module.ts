import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZatcaModule } from './zatca/zatca.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ZatcaModule],
})
export class AppModule {}
