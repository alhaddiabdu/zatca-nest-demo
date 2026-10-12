import { IsIn, IsOptional, IsString } from 'class-validator';
import { ZatcaEnvName } from '../../database/entities/environment.entity';
import { ZATCA_ENVS } from '../environments/environments.service';

export class SetModeDto {
  @IsIn(ZATCA_ENVS, { message: 'الوضع يجب أن يكون developer-portal أو simulation أو core' })
  mode: ZatcaEnvName;

  /** مطلوب للإنتاج فقط، ويجب أن يساوي CORE حرفياً */
  @IsOptional()
  @IsString()
  confirm?: string;
}
