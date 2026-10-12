import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoBoxService, MASTER_KEY, parseMasterKey } from './crypto-box.service';

@Global()
@Module({
  providers: [
    {
      provide: MASTER_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => parseMasterKey(config.get<string>('MASTER_KEY')),
    },
    CryptoBoxService,
  ],
  exports: [CryptoBoxService],
})
export class SecurityModule {}
