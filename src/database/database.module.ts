import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions(config.get<string>('DATABASE_URL')),
        // محاولات قليلة حتى يظهر خطأ الاتصال بسرعة
        retryAttempts: 3,
        retryDelay: 2000,
      }),
    }),
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const [row] = await this.dataSource.query(
      `select current_database() as db, current_setting('server_version') as version`,
    );
    this.logger.log(`متصل بقاعدة البيانات ${row.db} (PostgreSQL ${row.version})`);
  }
}
