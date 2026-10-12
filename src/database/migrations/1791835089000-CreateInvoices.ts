import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - invoices: كل فاتورة صادرة (أو تجربة dryRun) مع حالتها ورد الهيئة والـ XML
 * - compliance_checks: نتائج فحوصات الامتثال لكل محاولة تسجيل
 */
export class CreateInvoices1791835089000 implements MigrationInterface {
  name = 'CreateInvoices1791835089000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE invoices (
        id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        env                 varchar(20)   NOT NULL REFERENCES environments (env),
        invoice_number      varchar(127)  NOT NULL,
        is_dry_run          boolean       NOT NULL DEFAULT false,
        uuid                uuid          NOT NULL UNIQUE,
        category            varchar(10)   NOT NULL CHECK (category IN ('standard', 'simplified')),
        kind                varchar(10)   NOT NULL CHECK (kind IN ('invoice', 'credit', 'debit')),

        -- فارغة لفواتير التجربة لأنها لا تدخل السلسلة
        chain_epoch         integer,
        icv                 bigint,
        pih                 text,
        invoice_hash        text          NOT NULL,

        issue_date          date          NOT NULL,
        -- نص كما في XML لتجنب تحويل المنطقة الزمنية
        issue_time          varchar(8)    NOT NULL,
        buyer               jsonb,
        lines               jsonb         NOT NULL,
        payment_means_code  varchar(4),
        original_invoice_id varchar(127),
        reason              text,

        net_amount          numeric(18,2),
        vat_amount          numeric(18,2),
        total_amount        numeric(18,2),

        status              varchar(30)   NOT NULL CHECK (status IN (
                              'DRY_RUN', 'PENDING', 'ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'REJECTED')),
        submission_channel  varchar(10)   CHECK (submission_channel IN ('reporting', 'clearance')),
        http_status         smallint,
        zatca_response      jsonb,

        signed_xml          text          NOT NULL,
        cleared_xml         text,
        qr                  text          NOT NULL,

        attempts            integer       NOT NULL DEFAULT 0,
        next_retry_at       timestamptz,
        last_error          text,
        submitted_at        timestamptz,

        created_at          timestamptz   NOT NULL DEFAULT now(),
        updated_at          timestamptz   NOT NULL DEFAULT now()
      )
    `);

    // رقم الفاتورة فريد داخل الوضع، وفواتير التجربة لا تحجز الأرقام
    await queryRunner.query(`
      CREATE UNIQUE INDEX invoices_env_number_uq
        ON invoices (env, invoice_number) WHERE NOT is_dry_run
    `);
    // لا يتكرر العداد في نفس السلسلة حتى لو أخطأ القفل
    await queryRunner.query(`
      CREATE UNIQUE INDEX invoices_env_epoch_icv_uq
        ON invoices (env, chain_epoch, icv) WHERE icv IS NOT NULL
    `);
    // للوحة التحكم وجدول الفواتير
    await queryRunner.query(`
      CREATE INDEX invoices_env_status_created_idx
        ON invoices (env, status, created_at DESC)
    `);
    // للمُجدوِل: المعلّقة المستحقة لإعادة الإرسال
    await queryRunner.query(`
      CREATE INDEX invoices_pending_retry_idx
        ON invoices (next_retry_at) WHERE status = 'PENDING'
    `);

    await queryRunner.query(`
      CREATE TABLE compliance_checks (
        id           bigserial    PRIMARY KEY,
        env          varchar(20)  NOT NULL REFERENCES environments (env),
        run_id       uuid         NOT NULL,
        document     varchar(30)  NOT NULL,
        icv          integer      NOT NULL,
        uuid         uuid         NOT NULL,
        invoice_hash text         NOT NULL,
        http_status  smallint     NOT NULL,
        ok           boolean      NOT NULL,
        response     jsonb,
        created_at   timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX compliance_checks_env_run_idx ON compliance_checks (env, run_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE compliance_checks`);
    await queryRunner.query(`DROP TABLE invoices`);
  }
}
