import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { EnvironmentEntity, ZatcaEnvName } from './environment.entity';

/** صف واحد فقط (id = 1) يحفظ الوضع النشط. NULL = لم يُختر وضع بعد. */
@Entity({ name: 'app_settings' })
@Check('app_settings_id_check', `id = 1`)
export class AppSettingsEntity {
  @PrimaryColumn({ name: 'id', type: 'smallint', default: 1, primaryKeyConstraintName: 'app_settings_pkey' })
  id: number;

  @Column({ name: 'active_env', type: 'varchar', length: 20, nullable: true })
  activeEnv: ZatcaEnvName | null;

  @ManyToOne(() => EnvironmentEntity, { nullable: true })
  @JoinColumn({ name: 'active_env', referencedColumnName: 'env', foreignKeyConstraintName: 'app_settings_active_env_fkey' })
  activeEnvironment?: EnvironmentEntity | null;

  @Column({ name: 'core_confirmed_at', type: 'timestamptz', nullable: true })
  coreConfirmedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
