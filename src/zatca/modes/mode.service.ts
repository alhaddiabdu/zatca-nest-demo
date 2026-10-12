import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingsEntity } from '../../database/entities/app-settings.entity';
import { ZatcaEnvName } from '../../database/entities/environment.entity';
import { InvoiceEntity } from '../../database/entities/invoice.entity';
import { EnvironmentsService, EnvState, isZatcaEnv } from '../environments/environments.service';
import { CORE_CONFIRMATION, MODE_META } from './active-env';

export interface ModeInfo {
  env: ZatcaEnvName;
  label: string;
  color: string;
  state: EnvState;
  onboardedAt: Date | null;
  invoiceCount: number;
  pendingCount: number;
}

@Injectable()
export class ModeService {
  constructor(
    @InjectRepository(AppSettingsEntity) private readonly settings: Repository<AppSettingsEntity>,
    @InjectRepository(InvoiceEntity) private readonly invoices: Repository<InvoiceEntity>,
    private readonly environments: EnvironmentsService,
    private readonly config: ConfigService,
  ) {}

  /** الوضع المحفوظ كما هو (null = لم يُختر بعد، فتعرض الواجهة شاشة الاختيار) */
  async getActive(): Promise<ZatcaEnvName | null> {
    return (await this.settings.findOneBy({ id: 1 }))?.activeEnv ?? null;
  }

  /**
   * الوضع الذي تعمل عليه العمليات، أو 409 إن لم يُختر.
   * مرحلة انتقالية حتى الخطوة 30: إن لم يُختر وضع يُستخدم ZATCA_ENV حتى تبقى الواجهة القديمة تعمل.
   */
  async requireActive(): Promise<ZatcaEnvName> {
    const active = await this.getActive();
    if (active) return active;
    const legacy = this.config.get<string>('ZATCA_ENV');
    if (isZatcaEnv(legacy)) return legacy;
    throw new ConflictException({ code: 'NO_ACTIVE_MODE', message: 'لم يُختر وضع تشغيل بعد. اختر الوضع أولاً.' });
  }

  async setMode(mode: ZatcaEnvName, confirm?: string): Promise<{ active: ZatcaEnvName }> {
    if (!isZatcaEnv(mode)) {
      throw new BadRequestException({ code: 'UNKNOWN_MODE', message: `وضع غير معروف: ${mode}` });
    }
    if (mode === 'core' && confirm !== CORE_CONFIRMATION) {
      throw new BadRequestException({
        code: 'CORE_CONFIRMATION_REQUIRED',
        message: `تفعيل الإنتاج يتطلب كتابة ${CORE_CONFIRMATION} حرفياً في حقل confirm`,
      });
    }
    await this.settings.update(
      { id: 1 },
      { activeEnv: mode, ...(mode === 'core' ? { coreConfirmedAt: new Date() } : {}) },
    );
    return { active: mode };
  }

  async listModes(): Promise<{ active: ZatcaEnvName | null; modes: ModeInfo[] }> {
    const [active, rows, counts] = await Promise.all([
      this.getActive(),
      this.environments.list(),
      this.invoices
        .createQueryBuilder('i')
        .select('i.env', 'env')
        .addSelect('count(*) filter (where not i.is_dry_run)::int', 'invoiceCount')
        .addSelect(`count(*) filter (where i.status = 'PENDING')::int`, 'pendingCount')
        .groupBy('i.env')
        .getRawMany<{ env: ZatcaEnvName; invoiceCount: number; pendingCount: number }>(),
    ]);
    const byEnv = new Map(counts.map((c) => [c.env, c]));
    return {
      active,
      modes: rows.map((row) => ({
        env: row.env,
        ...MODE_META[row.env],
        state: this.environments.state(row),
        onboardedAt: row.onboardedAt,
        invoiceCount: byEnv.get(row.env)?.invoiceCount ?? 0,
        pendingCount: byEnv.get(row.env)?.pendingCount ?? 0,
      })),
    };
  }
}
