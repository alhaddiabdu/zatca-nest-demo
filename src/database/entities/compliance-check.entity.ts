import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EnvironmentEntity, ZatcaEnvName } from './environment.entity';

/** نتيجة فحص امتثال واحد ضمن محاولة تسجيل (run_id). */
@Entity({ name: 'compliance_checks' })
@Index('compliance_checks_env_run_idx', ['env', 'runId'])
export class ComplianceCheckEntity {
  @PrimaryGeneratedColumn({
    name: 'id',
    type: 'bigint',
    primaryKeyConstraintName: 'compliance_checks_pkey',
  })
  id: string;

  @Column({ name: 'env', type: 'varchar', length: 20 })
  env: ZatcaEnvName;

  @ManyToOne(() => EnvironmentEntity, { nullable: false })
  @JoinColumn({ name: 'env', referencedColumnName: 'env', foreignKeyConstraintName: 'compliance_checks_env_fkey' })
  environment?: EnvironmentEntity;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  /** مثل standard-invoice */
  @Column({ name: 'document', type: 'varchar', length: 30 })
  document: string;

  @Column({ name: 'icv', type: 'integer' })
  icv: number;

  @Column({ name: 'uuid', type: 'uuid' })
  uuid: string;

  @Column({ name: 'invoice_hash', type: 'text' })
  invoiceHash: string;

  @Column({ name: 'http_status', type: 'smallint' })
  httpStatus: number;

  @Column({ name: 'ok', type: 'boolean' })
  ok: boolean;

  @Column({ name: 'response', type: 'jsonb', nullable: true })
  response: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
