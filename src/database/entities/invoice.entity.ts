import {
  Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer, numericTransformer } from '../numeric.transformer';
import { EnvironmentEntity, ZatcaEnvName } from './environment.entity';

export type InvoiceStatus = 'DRY_RUN' | 'PENDING' | 'ACCEPTED' | 'ACCEPTED_WITH_WARNINGS' | 'REJECTED';

/** كل فاتورة صادرة أو تجربة dryRun، مع حالتها ورد الهيئة والـ XML. */
@Entity({ name: 'invoices' })
@Unique('invoices_uuid_key', ['uuid'])
@Index('invoices_env_number_uq', ['env', 'invoiceNumber'], { unique: true, where: 'NOT is_dry_run' })
@Index('invoices_env_epoch_icv_uq', ['env', 'chainEpoch', 'icv'], { unique: true, where: 'icv IS NOT NULL' })
@Index('invoices_env_status_created_idx', ['env', 'status', 'createdAt'])
@Index('invoices_pending_retry_idx', ['nextRetryAt'], { where: `status = 'PENDING'` })
@Check('invoices_category_check', `category IN ('standard', 'simplified')`)
@Check('invoices_kind_check', `kind IN ('invoice', 'credit', 'debit')`)
@Check(
  'invoices_status_check',
  `status IN ('DRY_RUN', 'PENDING', 'ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'REJECTED')`,
)
@Check('invoices_submission_channel_check', `submission_channel IN ('reporting', 'clearance')`)
export class InvoiceEntity {
  /** تولّده القاعدة بـ gen_random_uuid() (انظر الـ migration) */
  @PrimaryGeneratedColumn('uuid', { name: 'id', primaryKeyConstraintName: 'invoices_pkey' })
  id: string;

  @Column({ name: 'env', type: 'varchar', length: 20 })
  env: ZatcaEnvName;

  @ManyToOne(() => EnvironmentEntity, { nullable: false })
  @JoinColumn({ name: 'env', referencedColumnName: 'env', foreignKeyConstraintName: 'invoices_env_fkey' })
  environment?: EnvironmentEntity;

  @Column({ name: 'invoice_number', type: 'varchar', length: 127 })
  invoiceNumber: string;

  @Column({ name: 'is_dry_run', type: 'boolean', default: false })
  isDryRun: boolean;

  @Column({ name: 'uuid', type: 'uuid' })
  uuid: string;

  @Column({ name: 'category', type: 'varchar', length: 10 })
  category: 'standard' | 'simplified';

  @Column({ name: 'kind', type: 'varchar', length: 10 })
  kind: 'invoice' | 'credit' | 'debit';

  // ===== السلسلة (فارغة لفواتير التجربة) =====
  @Column({ name: 'chain_epoch', type: 'integer', nullable: true })
  chainEpoch: number | null;

  @Column({ name: 'icv', type: 'bigint', nullable: true, transformer: bigintTransformer })
  icv: number | null;

  @Column({ name: 'pih', type: 'text', nullable: true })
  pih: string | null;

  @Column({ name: 'invoice_hash', type: 'text' })
  invoiceHash: string;

  // ===== بيانات الفاتورة =====
  /** YYYY-MM-DD كما يعيده pg لعمود date */
  @Column({ name: 'issue_date', type: 'date' })
  issueDate: string;

  /** HH:mm:ssZ بتوقيت UTC كما في XML (الفواتير القديمة: HH:mm:ss بتوقيت الرياض) */
  @Column({ name: 'issue_time', type: 'varchar', length: 9 })
  issueTime: string;

  @Column({ name: 'buyer', type: 'jsonb', nullable: true })
  buyer: Record<string, unknown> | null;

  @Column({ name: 'lines', type: 'jsonb' })
  lines: Array<Record<string, unknown>>;

  @Column({ name: 'payment_means_code', type: 'varchar', length: 4, nullable: true })
  paymentMeansCode: string | null;

  @Column({ name: 'original_invoice_id', type: 'varchar', length: 127, nullable: true })
  originalInvoiceId: string | null;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'net_amount', type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  netAmount: number | null;

  @Column({ name: 'vat_amount', type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  vatAmount: number | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  totalAmount: number | null;

  // ===== الإرسال ورد الهيئة =====
  @Column({ name: 'status', type: 'varchar', length: 30 })
  status: InvoiceStatus;

  @Column({ name: 'submission_channel', type: 'varchar', length: 10, nullable: true })
  submissionChannel: 'reporting' | 'clearance' | null;

  @Column({ name: 'http_status', type: 'smallint', nullable: true })
  httpStatus: number | null;

  @Column({ name: 'zatca_response', type: 'jsonb', nullable: true })
  zatcaResponse: Record<string, unknown> | null;

  @Column({ name: 'signed_xml', type: 'text' })
  signedXml: string;

  @Column({ name: 'cleared_xml', type: 'text', nullable: true })
  clearedXml: string | null;

  @Column({ name: 'qr', type: 'text' })
  qr: string;

  // ===== إعادة المحاولة =====
  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
