import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../numeric.transformer';

export type ZatcaEnvName = 'developer-portal' | 'simulation' | 'core';

/**
 * صف لكل وضع تشغيل. الأعمدة المنتهية بـ _enc مشفرة بـ AES-256-GCM.
 * أسماء القيود مطابقة لما أنشأته الـ migration حتى لا يقترح TypeORM حذفها.
 */
@Entity({ name: 'environments' })
@Check('environments_env_check', `env IN ('developer-portal', 'simulation', 'core')`)
@Check('environments_seller_vat_number_check', `seller_vat_number ~ '^3[0-9]{13}3$'`)
@Check('environments_seller_crn_check', `seller_crn ~ '^[0-9]{10}$'`)
@Check('environments_seller_building_number_check', `seller_building_number ~ '^[0-9]{4}$'`)
@Check('environments_seller_postal_code_check', `seller_postal_code ~ '^[0-9]{5}$'`)
@Check('environments_egs_invoice_type_check', `egs_invoice_type IN ('1100', '1000', '0100')`)
@Check('environments_icv_check', `icv >= 0`)
export class EnvironmentEntity {
  @PrimaryColumn({ name: 'env', type: 'varchar', length: 20, primaryKeyConstraintName: 'environments_pkey' })
  env: ZatcaEnvName;

  // ===== البائع =====
  @Column({ name: 'seller_name', type: 'varchar', length: 200, nullable: true })
  sellerName: string | null;

  @Column({ name: 'seller_vat_number', type: 'char', length: 15, nullable: true })
  sellerVatNumber: string | null;

  @Column({ name: 'seller_crn', type: 'varchar', length: 10, nullable: true })
  sellerCrn: string | null;

  @Column({ name: 'seller_street', type: 'varchar', length: 200, nullable: true })
  sellerStreet: string | null;

  @Column({ name: 'seller_building_number', type: 'char', length: 4, nullable: true })
  sellerBuildingNumber: string | null;

  @Column({ name: 'seller_district', type: 'varchar', length: 100, nullable: true })
  sellerDistrict: string | null;

  @Column({ name: 'seller_city', type: 'varchar', length: 100, nullable: true })
  sellerCity: string | null;

  @Column({ name: 'seller_postal_code', type: 'char', length: 5, nullable: true })
  sellerPostalCode: string | null;

  // ===== وحدة إصدار الفواتير EGS =====
  @Column({ name: 'egs_common_name', type: 'varchar', length: 64, nullable: true })
  egsCommonName: string | null;

  @Column({ name: 'egs_org_unit', type: 'varchar', length: 64, nullable: true })
  egsOrgUnit: string | null;

  @Column({ name: 'egs_solution_name', type: 'varchar', length: 64, nullable: true })
  egsSolutionName: string | null;

  @Column({ name: 'egs_model', type: 'varchar', length: 64, nullable: true })
  egsModel: string | null;

  @Column({ name: 'egs_serial', type: 'varchar', length: 64, nullable: true })
  egsSerial: string | null;

  @Column({ name: 'egs_invoice_type', type: 'char', length: 4, nullable: true })
  egsInvoiceType: string | null;

  @Column({ name: 'egs_location', type: 'varchar', length: 64, nullable: true })
  egsLocation: string | null;

  @Column({ name: 'egs_industry', type: 'varchar', length: 64, nullable: true })
  egsIndustry: string | null;

  // ===== المفتاح والشهادات =====
  @Column({ name: 'private_key_enc', type: 'text', nullable: true })
  privateKeyEnc: string | null;

  @Column({ name: 'csr_pem', type: 'text', nullable: true })
  csrPem: string | null;

  @Column({ name: 'compliance_token_enc', type: 'text', nullable: true })
  complianceTokenEnc: string | null;

  @Column({ name: 'compliance_secret_enc', type: 'text', nullable: true })
  complianceSecretEnc: string | null;

  @Column({ name: 'compliance_request_id', type: 'varchar', length: 64, nullable: true })
  complianceRequestId: string | null;

  @Column({ name: 'production_token_enc', type: 'text', nullable: true })
  productionTokenEnc: string | null;

  @Column({ name: 'production_secret_enc', type: 'text', nullable: true })
  productionSecretEnc: string | null;

  @Column({ name: 'production_request_id', type: 'varchar', length: 64, nullable: true })
  productionRequestId: string | null;

  @Column({ name: 'production_cert_not_after', type: 'timestamptz', nullable: true })
  productionCertNotAfter: Date | null;

  @Column({ name: 'onboarded_at', type: 'timestamptz', nullable: true })
  onboardedAt: Date | null;

  // ===== سلسلة الفواتير =====
  @Column({ name: 'chain_epoch', type: 'integer', default: 1 })
  chainEpoch: number;

  @Column({ name: 'icv', type: 'bigint', default: 0, transformer: bigintTransformer })
  icv: number;

  @Column({
    name: 'pih',
    type: 'text',
    default: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  })
  pih: string;

  // ===== شهادة التجربة المحلية (dryRun) =====
  @Column({ name: 'local_test_key_enc', type: 'text', nullable: true })
  localTestKeyEnc: string | null;

  @Column({ name: 'local_test_cert_pem', type: 'text', nullable: true })
  localTestCertPem: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
