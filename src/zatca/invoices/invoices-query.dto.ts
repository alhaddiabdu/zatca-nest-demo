import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ZatcaEnvName } from '../../database/entities/environment.entity';
import { InvoiceStatus } from '../../database/entities/invoice.entity';
import { ZATCA_ENVS } from '../environments/environments.service';

export const INVOICE_STATUSES: InvoiceStatus[] = ['DRY_RUN', 'PENDING', 'ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'REJECTED'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class InvoicesQueryDto {
  /** الافتراضي: الوضع النشط */
  @IsOptional() @IsIn(ZATCA_ENVS, { message: 'وضع غير معروف' })
  env?: ZatcaEnvName;

  @IsOptional() @IsIn(INVOICE_STATUSES, { message: 'حالة غير معروفة' })
  status?: InvoiceStatus;

  @IsOptional() @IsIn(['standard', 'simplified'])
  category?: 'standard' | 'simplified';

  @IsOptional() @IsIn(['invoice', 'credit', 'debit'])
  kind?: 'invoice' | 'credit' | 'debit';

  /** رقم الفاتورة (جزء منه) أو UUID كامل */
  @IsOptional() @IsString() @MaxLength(127)
  q?: string;

  /** تاريخ الإصدار من/إلى (YYYY-MM-DD) */
  @IsOptional() @Matches(DATE, { message: 'from بصيغة YYYY-MM-DD' })
  from?: string;

  @IsOptional() @Matches(DATE, { message: 'to بصيغة YYYY-MM-DD' })
  to?: string;

  /** فواتير التجربة مخفية افتراضياً */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  includeDryRun?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'page من 1' })
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100, { message: 'pageSize من 1 إلى 100' })
  pageSize = 20;
}
